'use client';

import * as React from 'react';
import { RemoteParticipant, Track } from 'livekit-client';
import { useIsSpeaking, useTracks } from '@livekit/components-react';
import { CloseIcon, EyeOffIcon, Volume2Icon, VolumeXIcon } from '@/lib/icons';
import { useVolumeMixer } from '@/lib/VolumeMixerContext';
import {
  SLIDER_STEPS,
  formatDb,
  gainToSlider,
  sliderToGain,
  type SourceKey,
} from '@/lib/participantVolumes';
import styles from '../styles/ParticipantAudioPanel.module.css';

/**
 * Rastreia quem esta publicando audio de tela, pra so mostrar o slider de
 * audio da tela quando fizer sentido. A track e reativa via `useTracks`.
 * Extraido num hook proprio porque tanto o card de volume quanto o clique no
 * tile (que decide SE abre o card) precisam do mesmo dado.
 */
export function useScreenShareAudioIdentities(): Set<string> {
  const screenShareAudioRefs = useTracks([Track.Source.ScreenShareAudio], {
    onlySubscribed: false,
  });
  return React.useMemo(
    () => new Set(screenShareAudioRefs.map((ref) => ref.participant.identity)),
    [screenShareAudioRefs],
  );
}

/**
 * Um controle de volume (slider + mute) para uma fonte de audio de um
 * participante. E UI BURRA: nao guarda estado, nao persiste nada e nao chama
 * `setVolume` — tudo isso e do `VolumeMixerContext` e do
 * `<VolumeMixerBinder />`. Mesma divisao que o painel de configuracoes tem com
 * o `MicProcessorContext`.
 */
export function VolumeControl(props: {
  /** Username limpo (`participant.name`), nunca a identity. */
  name: string;
  sourceKey: SourceKey;
  label: string;
  /** Quando true, mostra que o modo foco esta calando isto. */
  focusMuted?: boolean;
}) {
  const { name, sourceKey, label, focusMuted } = props;
  const mixer = useVolumeMixer();
  if (!mixer) {
    return null;
  }

  const volume = mixer.volumeFor(name, sourceKey);
  const isMuted = volume === 0;

  if (focusMuted) {
    // Um slider que nao faz diferenca nenhuma e pior que nenhum slider: a
    // pessoa arrasta, nada muda, e ela conclui que o app esta quebrado.
    return (
      <div className={`${styles.volumeRow} ${styles.focusMutedRow}`}>
        <EyeOffIcon size={16} />
        <span className={styles.volumeLabel}>{label}</span>
        <span className={styles.focusMutedHint}>silenciado pelo modo foco</span>
      </div>
    );
  }

  return (
    <div className={styles.volumeRow}>
      <button
        type="button"
        className={`lk-button ${styles.muteButton}`}
        aria-pressed={isMuted}
        aria-label={isMuted ? `Desmutar ${label}` : `Mutar ${label} só pra mim`}
        title={isMuted ? `Desmutar ${label}` : `Mutar ${label} só pra mim`}
        onClick={() => mixer.toggleMute(name, sourceKey)}
      >
        {isMuted ? <VolumeXIcon size={16} /> : <Volume2Icon size={16} />}
      </button>
      <span className={styles.volumeLabel}>{label}</span>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        // A posicao passa pela curva perceptual; o que e guardado continua
        // sendo o ganho linear.
        value={Math.round(gainToSlider(volume))}
        onChange={(e) => mixer.setVolume(name, sourceKey, sliderToGain(Number(e.target.value)))}
        aria-label={`Volume de ${label} de ${name}`}
        aria-valuetext={`${Math.round(volume * 100)} por cento, ${formatDb(volume)}`}
      />
      <span className={styles.volumeValue} title={`Ganho linear ${volume.toFixed(2)}×`}>
        {Math.round(volume * 100)}%<small className={styles.volumeDb}>{formatDb(volume)}</small>
      </span>
    </div>
  );
}

/**
 * Card de volume de UM participante, aberto ao clicar no tile dele dentro da
 * call (estilo Discord) — ver <CallParticipantTile />. E o caminho RAPIDO
 * durante a chamada; a lista completa de todo mundo vive na janela de
 * configuracoes, secao Mixer.
 *
 * `anchor` posiciona o card perto de onde a pessoa clicou (coordenadas do
 * MouseEvent nativo, capturadas pelo tile — a API publica de
 * `onParticipantClick` do @livekit/components-react nao expoe essas
 * coordenadas, por isso o tile as captura direto no onClick e repassa aqui).
 */
export function ParticipantVolumeCard(props: {
  participant: RemoteParticipant;
  hasScreenShareAudio: boolean;
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  const { participant, hasScreenShareAudio, anchor, onClose } = props;
  const isSpeaking = useIsSpeaking(participant);
  const mixer = useVolumeMixer();
  const name = participant.name || participant.identity;
  const focusMuted = mixer?.isFocusMuted(name) ?? false;

  // Fecha com Escape ou clique fora — sem isso o card fica pendurado na tela.
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Mantem o card dentro da viewport mesmo quando o clique foi perto de uma
  // borda — a largura/altura real so existe apos o primeiro render, entao o
  // clamp usa um tamanho maximo conhecido (ver .card no CSS) como estimativa.
  const CARD_WIDTH = 280;
  const CARD_HEIGHT = 220;
  const style: React.CSSProperties =
    typeof window === 'undefined'
      ? {}
      : {
          left: Math.min(
            Math.max(anchor.x - CARD_WIDTH / 2, 8),
            window.innerWidth - CARD_WIDTH - 8,
          ),
          top: Math.min(
            Math.max(anchor.y - CARD_HEIGHT - 12, 8),
            window.innerHeight - CARD_HEIGHT - 8,
          ),
        };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        className={`${styles.card} ${isSpeaking ? styles.speaking : ''}`}
        style={style}
        role="dialog"
        aria-label={`Volume de ${name}`}
      >
        <div className={styles.cardHeader}>
          <span className={styles.participantName}>{name}</span>
          <button type="button" className="lk-button" onClick={onClose} aria-label="Fechar">
            <CloseIcon size={16} />
          </button>
        </div>
        {/* O modo foco cala so a VOZ — audio de tela e soundboard continuam
            passando de propósito (ver VolumeMixerBinder.tsx). */}
        <VolumeControl name={name} sourceKey="mic" label="Voz" focusMuted={focusMuted} />
        {hasScreenShareAudio && (
          <VolumeControl name={name} sourceKey="screenShareAudio" label="Áudio da tela" />
        )}
        {/* Terceira fonte, independente da voz: da pra calar a soundboard de
            alguem e continuar ouvindo a pessoa falar. Ver
            lib/soundboardEvents.ts. */}
        <VolumeControl name={name} sourceKey="soundboard" label="Soundboard" />
      </div>
    </>
  );
}
