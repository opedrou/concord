'use client';

import * as React from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { LocalAudioTrack, RoomEvent, Track } from 'livekit-client';
import { isMonitorDevice } from './noiseSuppression';
import {
  GATE_MAX,
  GATE_MIN,
  MicGateProcessor,
  dbToMeterFraction,
  hasGateThresholdBeenSetExplicitly,
  loadGateThresholdPref,
  markGateThresholdTouched,
  saveGateThresholdPref,
} from './micGate';
import { MicIcon } from '@/lib/icons';
import styles from '../styles/MicGateControl.module.css';

/**
 * Sensibilidade de entrada do microfone (noise gate), estilo "Input
 * Sensitivity" do Discord: abaixo do limiar escolhido, o audio nao e
 * transmitido — mas via GATE DE GANHO (ver lib/micGate.ts), nunca
 * ligando/desligando a track. Ligar/desligar a cada oscilacao de nivel
 * republicaria a faixa a cada vez e piscaria o icone de mutado pra todo
 * mundo — foi isso que o dono pediu pra evitar.
 *
 * O componente fica SEMPRE montado (mesmo padrao do
 * `NoiseSuppressionControl`): o processor precisa continuar aplicado ao
 * microfone o tempo todo, independente do popover de configuracoes de audio
 * estar aberto — por isso o popover que o contem (ver CallControlBar.tsx) é
 * escondido por CSS, nunca desmontado, e `props.open` liga/desliga apenas o
 * redesenho do medidor ao vivo.
 */
export function MicGateControl(props: { open: boolean }) {
  const room = useRoomContext();
  const { microphoneTrack } = useLocalParticipant();

  const [threshold, setThreshold] = React.useState<number>(loadGateThresholdPref);
  const thresholdRef = React.useRef(threshold);
  thresholdRef.current = threshold;

  const [monitorDeviceHint, setMonitorDeviceHint] = React.useState(false);
  const [processorFailed, setProcessorFailed] = React.useState(false);

  const processorRef = React.useRef<MicGateProcessor | null>(null);
  const trackRef = React.useRef<LocalAudioTrack | null>(null);

  const trackFillRef = React.useRef<HTMLDivElement | null>(null);
  const trackWrapperRef = React.useRef<HTMLDivElement | null>(null);

  // Aplica (ou reaplica, em troca de dispositivo) o processor de gate na
  // track de microfone atual. Falha de processor NUNCA pode deixar a pessoa
  // muda — se `setProcessor` rejeitar, a track continua publicando sem
  // processamento nenhum (fallback silencioso, so avisa na UI).
  const attachToTrack = React.useCallback(async (track: LocalAudioTrack) => {
    if (trackRef.current === track && processorRef.current) {
      // Mesma track de sempre (ex: reaplicacao vinda de outro efeito) — so
      // garante que o threshold esta em dia, sem recriar a cadeia de audio.
      processorRef.current.setThreshold(thresholdRef.current);
      return;
    }
    // Track antiga (device trocado) — desmonta o processor dela antes de
    // seguir, pra nao deixar AnalyserNode/GainNode orfaos rodando.
    if (trackRef.current && trackRef.current !== track) {
      trackRef.current.stopProcessor().catch(() => {});
    }
    trackRef.current = track;
    const mst = track.mediaStreamTrack;
    setMonitorDeviceHint(isMonitorDevice(mst?.label));

    const processor = new MicGateProcessor(thresholdRef.current);
    try {
      await track.setProcessor(processor);
      processorRef.current = processor;
      setProcessorFailed(false);
    } catch {
      // getUserMedia/AudioContext podem falhar por mil motivos de
      // navegador/dispositivo — cai pra track crua, sem gate, e avisa.
      processorRef.current = null;
      setProcessorFailed(true);
    }
  }, []);

  // Primeiro publish + toda vez que a `microphoneTrack` (re)aparece.
  React.useEffect(() => {
    const track = microphoneTrack?.track;
    if (!track || !(track instanceof LocalAudioTrack)) return;
    attachToTrack(track);
  }, [microphoneTrack, attachToTrack]);

  // Cobre a corrida entre o publish acontecer e o hook acima ainda nao ter
  // re-renderizado com a `microphoneTrack` nova (mesmo padrao do
  // NoiseSuppressionControl).
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

  // Device "Monitor of ..." (audio de jogo capturado como mic — HANDOFF
  // secao 4): um gate com limiar alto destruiria os trechos silenciosos do
  // jogo. Na PRIMEIRA vez que detectamos esse device (nunca antes de a
  // pessoa ter mexido no slider), forcamos o gate desligado. Depois disso a
  // escolha da pessoa sempre prevalece — so avisamos, nao insistimos.
  React.useEffect(() => {
    if (!monitorDeviceHint) return;
    if (hasGateThresholdBeenSetExplicitly()) return;
    setThreshold((current) => {
      if (current === GATE_MIN) return current;
      saveGateThresholdPref(GATE_MIN);
      processorRef.current?.setThreshold(GATE_MIN);
      return GATE_MIN;
    });
  }, [monitorDeviceHint]);

  const handleChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setThreshold(next);
    saveGateThresholdPref(next);
    markGateThresholdTouched();
    processorRef.current?.setThreshold(next);
  }, []);

  // Liga/desliga o callback de nivel ao vivo do processor de acordo com o
  // popover de configuracoes de audio estar aberto — e assim que o "para de medir quando o painel
  // esta fechado" e cumprido: o loop de audio do gate (setInterval em
  // micGate.ts) continua rodando SEMPRE, porque e o que faz o gate
  // funcionar; o que liga/desliga aqui e so o redesenho do medidor visual,
  // que nao tem custo nenhum quando ninguem esta olhando pro popover.
  React.useEffect(() => {
    const processor = processorRef.current;
    if (!props.open || !processor) return undefined;

    processor.onLevel = ({ levelDb }) => {
      // Fracao 0..1 do nivel atual -> ate onde a camada acesa do medidor vai
      // (o CSS traduz isso em clip-path; ver MicGateControl.module.css).
      const frac = dbToMeterFraction(levelDb);
      if (trackFillRef.current) {
        trackFillRef.current.style.setProperty('--mic-gate-level', `${(frac * 100).toFixed(1)}%`);
      }
    };
    return () => {
      processor.onLevel = undefined;
    };
    // Reagarra sempre que o popover abre/fecha OU a track muda (novo
    // processor). `processorFailed` entra na dependencia so pra reagarrar
    // depois de um fallback bem-sucedido numa tentativa seguinte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, microphoneTrack, processorFailed]);

  React.useEffect(() => {
    return () => {
      trackRef.current?.stopProcessor().catch(() => {});
    };
  }, []);

  const thresholdPct = ((threshold - GATE_MIN) / (GATE_MAX - GATE_MIN)) * 100;
  const valueText =
    threshold <= GATE_MIN
      ? 'Desligado — microfone sempre aberto'
      : `${threshold} de 100 — corta o áudio abaixo desse nível`;

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor="mic-gate-threshold">
        <MicIcon size={16} />
        <span className={styles.labelText}>Sensibilidade de entrada</span>
      </label>

      <div
        className={styles.meter}
        ref={trackWrapperRef}
        style={{ '--mic-gate-threshold': `${thresholdPct}%` } as React.CSSProperties}
      >
        {/* Duas camadas com o MESMO gradiente (âmbar antes do limiar, verde
            depois), uma apagada e outra acesa — igual ao Discord: a trilha
            inteira aparece em tom escuro, e o pedaço correspondente ao nível
            ao vivo do microfone acende por cima. Assim dá pra ler ao mesmo
            tempo ONDE está o limiar (troca de cor) e QUANTO o mic está
            captando agora (até onde vai o tom aceso). */}
        <div className={styles.meterDim} />
        <div className={styles.meterActive} ref={trackFillRef} />
        <input
          id="mic-gate-threshold"
          className={styles.rangeInput}
          type="range"
          min={GATE_MIN}
          max={GATE_MAX}
          step={1}
          value={threshold}
          onChange={handleChange}
          aria-label="Sensibilidade de entrada do microfone"
          aria-valuetext={valueText}
        />
      </div>

      <p className={styles.hint}>
        {threshold <= GATE_MIN
          ? 'Gate desligado — o microfone transmite o tempo todo.'
          : 'Abaixo da marca, o áudio não é transmitido. A barra mostra o nível do seu mic ao vivo.'}
      </p>

      {monitorDeviceHint && (
        <p className={styles.warning}>
          Dispositivo &quot;Monitor of...&quot; detectado (áudio do sistema
          como microfone) — um limiar alto cortaria os trechos silenciosos do
          jogo. Deixamos desligado por padrão; mexa só se souber o que está
          fazendo.
        </p>
      )}

      {processorFailed && (
        <p className={styles.warning}>
          Não foi possível ativar o filtro de sensibilidade neste navegador —
          o microfone continua funcionando normalmente, só sem o gate.
        </p>
      )}
    </div>
  );
}
