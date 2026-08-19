'use client';

import * as React from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { LocalAudioTrack, RoomEvent, Track } from 'livekit-client';
import { useMicProcessorInternals } from './MicProcessorContext';
import { MicProcessorChain, GATE_MIN, hasGateThresholdBeenSetExplicitly } from './micProcessor';
import { levelToDenoiseModel, type DenoiseModel } from './denoise';
import { buildAudioCaptureConstraints, isMonitorDevice, readAppliedTier } from './noiseSuppression';

/**
 * Dono do processamento de microfone. Nao renderiza nada.
 *
 * Vive DENTRO do `RoomContext.Provider` (ver PageClientImpl), porque so ali
 * existem `useRoomContext`/`useLocalParticipant`. Escreve tudo que a UI precisa
 * no `MicProcessorContext`, que fica acima das duas arvores — ver o desenho no
 * topo daquele arquivo.
 *
 * Ser headless e o ponto principal: o painel de configuracoes pode abrir,
 * fechar e desmontar à vontade que o processor continua aplicado à track. Antes
 * disso, o `MicGateControl` era dono da cadeia de audio e por isso o popover
 * tinha que ser escondido por CSS em vez de desmontado.
 */
export function MicProcessorBinder() {
  const room = useRoomContext();
  const { microphoneTrack } = useLocalParticipant();
  const internals = useMicProcessorInternals();

  const processorRef = React.useRef<MicProcessorChain | null>(null);
  const trackRef = React.useRef<LocalAudioTrack | null>(null);

  // Reaplica as constraints NATIVAS na track. Chamada tanto quando a pessoa
  // liga/desliga a camada do navegador quanto quando troca o modelo neural —
  // as duas coisas mudam o que se pede ao getUserMedia (ver
  // `buildAudioCaptureConstraints`: com modelo neural ativo, a supressao
  // nativa e desligada pra nao filtrar duas vezes).
  const applyConstraints = React.useCallback(
    async (model: DenoiseModel, browserEnabled: boolean) => {
      const mst = trackRef.current?.mediaStreamTrack;
      if (!mst) return;
      try {
        // `applyConstraints` muda a captura sem republicar a track — troca o
        // "quanto processar" sem cortar o audio de ninguem.
        await mst.applyConstraints(
          buildAudioCaptureConstraints(browserEnabled, model !== 'off') as MediaTrackConstraints,
        );
      } catch {
        // Navegador recusou, ou a constraint nao existe pra esse dispositivo. A
        // track continua publicando normalmente, so sem a camada pedida — erro
        // de filtro nunca pode tirar a pessoa da call.
      }
      // `browserEnabled && model === 'off'`: com modelo neural rodando, as
      // constraints nativas de supressao vao a `false` de proposito, entao ler
      // "camada aplicada" ali diria "indisponivel" e a UI mostraria um aviso
      // falso. A camada nativa so e a camada VIGENTE quando nao ha neural.
      internals?.report({ browserTier: readAppliedTier(mst, browserEnabled && model === 'off') });
    },
    [internals],
  );

  const attachToTrack = React.useCallback(
    async (track: LocalAudioTrack) => {
      if (!internals) return;
      const { threshold, noiseLevel } = internals.desired.current;
      const denoiseModel = levelToDenoiseModel(noiseLevel);

      if (trackRef.current === track && processorRef.current) {
        // Mesma track de sempre (reaplicacao vinda de outro efeito) — so garante
        // que os valores estao em dia, sem recriar a cadeia de audio.
        processorRef.current.setThreshold(threshold);
        return;
      }
      // Track antiga (device trocado) — desmonta o processor dela antes de
      // seguir, pra nao deixar nós Web Audio orfaos rodando.
      if (trackRef.current && trackRef.current !== track) {
        trackRef.current.stopProcessor().catch(() => {});
      }
      trackRef.current = track;

      const monitorDevice = isMonitorDevice(track.mediaStreamTrack?.label);
      internals.report({ active: true, monitorDevice });

      const processor = new MicProcessorChain(threshold, denoiseModel);
      processor.onLevel = ({ levelDb }) => internals.emitLevel(levelDb);
      processor.onDenoiseStatus = (denoiseStatus) => internals.report({ denoiseStatus });
      try {
        await track.setProcessor(processor);
        processorRef.current = processor;
        internals.report({ processorFailed: false });
      } catch {
        // getUserMedia/AudioContext podem falhar por mil motivos de
        // navegador/dispositivo — cai pra track crua, sem processamento, e
        // avisa na UI.
        processorRef.current = null;
        internals.report({ processorFailed: true, denoiseStatus: 'off' });
      }

      await applyConstraints(denoiseModel, noiseLevel !== 'off');

      // Device "Monitor of ..." (audio de jogo capturado como microfone —
      // HANDOFF secao 4): tanto um gate com limiar alto quanto a reducao de
      // ruido destroem esse audio. Na PRIMEIRA vez que detectamos esse device
      // (nunca por cima de uma escolha ja feita), desligamos os dois. Depois
      // disso a escolha da pessoa sempre prevalece — so avisamos.
      if (monitorDevice && !hasGateThresholdBeenSetExplicitly()) {
        internals.override({ threshold: GATE_MIN, noiseLevel: 'off' });
      }
    },
    [internals, applyConstraints],
  );

  // Expoe os comandos imperativos pro provider: e assim que um clique no painel
  // (outra arvore de React) chega ate o processor.
  React.useEffect(() => {
    if (!internals) return undefined;
    internals.register({
      applyThreshold: (value) => processorRef.current?.setThreshold(value),
      applyNoiseLevel: (model, browserEnabled) => {
        void processorRef.current?.setDenoise(model);
        void applyConstraints(model, browserEnabled);
      },
    });
    return () => internals.register(null);
  }, [internals, applyConstraints]);

  // Primeiro publish + toda vez que a `microphoneTrack` (re)aparece.
  React.useEffect(() => {
    const track = microphoneTrack?.track;
    if (!track || !(track instanceof LocalAudioTrack)) return;
    attachToTrack(track);
  }, [microphoneTrack, attachToTrack]);

  // Cobre a corrida entre o publish acontecer e o hook acima ainda nao ter
  // re-renderizado com a `microphoneTrack` nova.
  React.useEffect(() => {
    const handleLocalTrackPublished = () => {
      const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      if (track instanceof LocalAudioTrack) {
        attachToTrack(track);
      }
    };
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    };
  }, [room, attachToTrack]);

  React.useEffect(() => {
    return () => {
      trackRef.current?.stopProcessor().catch(() => {});
      trackRef.current = null;
      processorRef.current = null;
      internals?.report({ active: false, denoiseStatus: 'off', monitorDevice: false });
    };
  }, [internals]);

  return null;
}
