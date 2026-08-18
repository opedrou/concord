'use client';

import * as React from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import {
  buildAudioCaptureConstraints,
  loadNoiseSuppressionPref,
  NoiseSuppressionTier,
  readAppliedTier,
  saveNoiseSuppressionPref,
  tierLabel,
} from './noiseSuppression';
import { MicIcon, MicOffIcon } from '@/lib/icons';
import styles from '../styles/NoiseSuppressionControl.module.css';

/**
 * Controle de reducao de ruido do microfone, com deteccao de capacidade em
 * runtime e fallback silencioso:
 *
 * 1. "avancada" — `voiceIsolation` nativo do navegador (mais forte, Chrome
 *    recente), quando suportado.
 * 2. "navegador" — `noiseSuppression`/`echoCancellation`/`autoGainControl`
 *    nativos do getUserMedia, suportados em praticamente todo lugar.
 * 3. "indisponivel" — navegador nao suporta nenhuma das constraints acima; o
 *    microfone continua funcionando normalmente, so sem reducao de ruido.
 *
 * Nao existe camada extra via `@livekit/track-processors` (0.7.0): a lib so
 * tem processadores de VIDEO (blur/virtual background). Krisp so roda no
 * LiveKit Cloud, nao nesta instancia self-hosted (HANDOFF secao 3). Por isso
 * a "camada avancada" real disponivel hoje e o `voiceIsolation` do proprio
 * navegador, nao um processador WASM proprio.
 *
 * A UI sempre mostra a camada REALMENTE aplicada (lida de volta via
 * `track.getSettings()`), nunca so o que foi pedido — importante pra nao
 * anunciar "ativado" quando o navegador ignorou a constraint.
 */
export function NoiseSuppressionControl() {
  const room = useRoomContext();
  const { microphoneTrack } = useLocalParticipant();
  const [enabled, setEnabled] = React.useState(loadNoiseSuppressionPref);
  const [tier, setTier] = React.useState<NoiseSuppressionTier>('unavailable');
  const [monitorDeviceHint, setMonitorDeviceHint] = React.useState(false);
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;

  const applyToTrack = React.useCallback(async (mst: MediaStreamTrack, wantEnabled: boolean) => {
    const constraints = buildAudioCaptureConstraints(wantEnabled);
    try {
      // applyConstraints muda a captura sem precisar republicar a track —
      // troca o "quanto processar" sem cortar o audio.
      await mst.applyConstraints(constraints as MediaTrackConstraints);
    } catch {
      // Navegador recusou (ou a constraint nao existe pra esse dispositivo).
      // A track continua publicando normalmente, so sem a reducao pedida —
      // erro de filtro nunca pode tirar a pessoa da call.
    }
    setTier(readAppliedTier(mst, wantEnabled));
    // Dispositivo tipo "Monitor of ..." (PipeWire, workaround do HANDOFF pra
    // levar audio de jogo pelo canal de voz) — reducao de ruido agressiva
    // mutila esse audio. So avisamos, a pessoa decide desligar.
    setMonitorDeviceHint(/monitor of/i.test(mst.label ?? ''));
  }, []);

  // Aplica a preferencia atual sempre que a track de microfone (re)aparece —
  // cobre o primeiro publish e trocas de dispositivo.
  React.useEffect(() => {
    const mst = microphoneTrack?.track?.mediaStreamTrack;
    if (!mst) {
      return;
    }
    applyToTrack(mst, enabled);
  }, [microphoneTrack, applyToTrack, enabled]);

  // Cobre o caso de o publish acontecer entre o efeito acima montar e o hook
  // ainda nao ter re-renderizado com a nova `microphoneTrack`.
  React.useEffect(() => {
    const handleLocalTrackPublished = () => {
      const mst = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track
        ?.mediaStreamTrack;
      if (mst) {
        applyToTrack(mst, enabledRef.current);
      }
    };
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    };
  }, [room, applyToTrack]);

  const toggle = React.useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      saveNoiseSuppressionPref(next);
      return next;
    });
  }, []);

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={`lk-button ${styles.toggleButton}`}
        onClick={toggle}
        aria-pressed={enabled}
        title={`Redução de ruído: ${tierLabel(tier)}`}
      >
        {enabled ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
        <span className={styles.label}>{tierLabel(tier)}</span>
      </button>
      {monitorDeviceHint && enabled && (
        <p className={styles.hint}>
          O microfone selecionado parece ser um dispositivo &quot;Monitor
          of...&quot; (áudio do sistema capturado como microfone). Redução de
          ruído pode estragar esse áudio — considere desligar aqui.
        </p>
      )}
    </div>
  );
}
