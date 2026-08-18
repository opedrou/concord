'use client';

import * as React from 'react';
import { RemoteParticipant, Track } from 'livekit-client';
import { useIsSpeaking, useRemoteParticipants, useTracks } from '@livekit/components-react';
import { CloseIcon, SlidersIcon, Volume2Icon, VolumeXIcon } from '@/lib/icons';
import styles from '../styles/ParticipantAudioPanel.module.css';

// Volume 1 = 100%. A API do livekit-client aceita valores acima de 1 (boost),
// mas isso so tem efeito de verdade quando o elemento de audio usa um GainNode
// (WebAudio). Sem isso o navegador ignora valores acima de 1 no <audio>.volume
// e o boost fica sem efeito pratico — ver limitacao no HANDOFF/relatorio.
const DEFAULT_VOLUME = 1;
const MAX_VOLUME = 2;
const STORAGE_PREFIX = 'lk-participant-volume:';

type SourceKey = 'mic' | 'screenShareAudio';

const SOURCE_MAP: Record<SourceKey, Track.Source.Microphone | Track.Source.ScreenShareAudio> = {
  mic: Track.Source.Microphone,
  screenShareAudio: Track.Source.ScreenShareAudio,
};

interface StoredVolumeState {
  volume: Partial<Record<SourceKey, number>>;
  mutedPrevVolume: Partial<Record<SourceKey, number>>;
}

function storageKey(identity: string) {
  return `${STORAGE_PREFIX}${identity}`;
}

function loadStoredState(identity: string): StoredVolumeState {
  if (typeof window === 'undefined') {
    return { volume: {}, mutedPrevVolume: {} };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(identity));
    if (!raw) {
      return { volume: {}, mutedPrevVolume: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      volume: parsed.volume ?? {},
      mutedPrevVolume: parsed.mutedPrevVolume ?? {},
    };
  } catch {
    return { volume: {}, mutedPrevVolume: {} };
  }
}

function saveStoredState(identity: string, state: StoredVolumeState) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(identity), JSON.stringify(state));
  } catch {
    // localStorage pode falhar (modo privado, quota etc). Persistencia e um
    // bonus, nao precisa quebrar a UI por isso.
  }
}

/**
 * Um controle de volume (slider + mute) para uma fonte de audio (mic ou
 * audio de tela) de um participante remoto. `setVolume`/`getVolume` sao
 * locais: so afetam o que quem esta ouvindo escuta, nao mutam ninguem
 * globalmente.
 */
function VolumeControl(props: {
  participant: RemoteParticipant;
  sourceKey: SourceKey;
  label: string;
  storedState: StoredVolumeState;
  onStoredStateChange: (next: StoredVolumeState) => void;
}) {
  const { participant, sourceKey, label, storedState, onStoredStateChange } = props;
  const source = SOURCE_MAP[sourceKey];

  const initialVolume = storedState.volume[sourceKey] ?? DEFAULT_VOLUME;
  const [volume, setVolumeState] = React.useState(initialVolume);
  const isMuted = volume === 0;

  // Aplica o volume salvo assim que o componente monta (ou quando o
  // participante reconecta) — setVolume pode ser chamado mesmo antes da
  // track existir, o livekit-client aplica quando ela e publicada.
  React.useEffect(() => {
    participant.setVolume(initialVolume, source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, source]);

  const applyVolume = React.useCallback(
    (next: number) => {
      setVolumeState(next);
      participant.setVolume(next, source);
      const nextState: StoredVolumeState = {
        volume: { ...storedState.volume, [sourceKey]: next },
        mutedPrevVolume: storedState.mutedPrevVolume,
      };
      onStoredStateChange(nextState);
    },
    [participant, source, sourceKey, storedState, onStoredStateChange],
  );

  const toggleMute = React.useCallback(() => {
    if (isMuted) {
      const restored = storedState.mutedPrevVolume[sourceKey] ?? DEFAULT_VOLUME;
      setVolumeState(restored);
      participant.setVolume(restored, source);
      onStoredStateChange({
        volume: { ...storedState.volume, [sourceKey]: restored },
        mutedPrevVolume: storedState.mutedPrevVolume,
      });
    } else {
      setVolumeState(0);
      participant.setVolume(0, source);
      onStoredStateChange({
        volume: { ...storedState.volume, [sourceKey]: 0 },
        mutedPrevVolume: { ...storedState.mutedPrevVolume, [sourceKey]: volume },
      });
    }
  }, [isMuted, participant, source, sourceKey, storedState, onStoredStateChange, volume]);

  return (
    <div className={styles.volumeRow}>
      <button
        type="button"
        className={`lk-button ${styles.muteButton}`}
        aria-pressed={isMuted}
        aria-label={isMuted ? `Desmutar ${label}` : `Mutar ${label} só pra mim`}
        title={isMuted ? `Desmutar ${label}` : `Mutar ${label} só pra mim`}
        onClick={toggleMute}
      >
        {isMuted ? <VolumeXIcon size={16} /> : <Volume2Icon size={16} />}
      </button>
      <span className={styles.volumeLabel}>{label}</span>
      <input
        className={styles.slider}
        type="range"
        min={0}
        max={MAX_VOLUME * 100}
        step={5}
        value={Math.round(volume * 100)}
        onChange={(e) => applyVolume(Number(e.target.value) / 100)}
        aria-label={`Volume de ${label} de ${participant.identity}`}
      />
      <span className={styles.volumeValue}>{Math.round(volume * 100)}%</span>
    </div>
  );
}

/** Uma linha do painel: nome do participante + seus controles de volume. */
function ParticipantRow(props: { participant: RemoteParticipant; hasScreenShareAudio: boolean }) {
  const { participant, hasScreenShareAudio } = props;
  const isSpeaking = useIsSpeaking(participant);

  // Estado persistido em localStorage, por identidade do participante.
  // Guardamos as duas fontes (mic + screen share audio) no mesmo registro.
  const [storedState, setStoredState] = React.useState<StoredVolumeState>(() =>
    loadStoredState(participant.identity),
  );

  const handleStoredStateChange = React.useCallback(
    (next: StoredVolumeState) => {
      setStoredState(next);
      saveStoredState(participant.identity, next);
    },
    [participant.identity],
  );

  return (
    <li className={`${styles.participantRow} ${isSpeaking ? styles.speaking : ''}`}>
      <div className={styles.participantName}>{participant.name || participant.identity}</div>
      <VolumeControl
        participant={participant}
        sourceKey="mic"
        label="Voz"
        storedState={storedState}
        onStoredStateChange={handleStoredStateChange}
      />
      {hasScreenShareAudio && (
        <VolumeControl
          participant={participant}
          sourceKey="screenShareAudio"
          label="Áudio da tela"
          storedState={storedState}
          onStoredStateChange={handleStoredStateChange}
        />
      )}
    </li>
  );
}

/**
 * Painel de participantes com controle de volume local, estilo Discord.
 *
 * `VideoConferenceProps`/`ControlBarProps` do @livekit/components-react nao
 * permitem injetar um botao extra na barra de controle (nao existe slot para
 * isso). A alternativa menos invasiva e um botao flutuante proprio, renderizado
 * ao lado do <VideoConference> dentro do mesmo RoomContext.Provider, que abre
 * um drawer lateral — nao exige recompor a ControlBar nem tocar no layout
 * principal da videoconferencia.
 */
export function ParticipantAudioPanel() {
  const [isOpen, setIsOpen] = React.useState(false);
  const remoteParticipants = useRemoteParticipants();

  // Rastreia quem esta publicando audio de tela para so mostrar o segundo
  // slider quando fizer sentido (a track e reativa via este hook).
  const screenShareAudioRefs = useTracks([Track.Source.ScreenShareAudio], {
    onlySubscribed: false,
  });
  const screenShareAudioIdentities = React.useMemo(
    () => new Set(screenShareAudioRefs.map((ref) => ref.participant.identity)),
    [screenShareAudioRefs],
  );

  return (
    <>
      <button
        type="button"
        className={`lk-button ${styles.toggleButton}`}
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        title="Volume por participante"
      >
        <SlidersIcon size={18} /> Participantes
      </button>
      {isOpen && (
        <div className={styles.panel} role="dialog" aria-label="Volume por participante">
          <div className={styles.panelHeader}>
            <h3>Volume por participante</h3>
            <button
              type="button"
              className="lk-button"
              onClick={() => setIsOpen(false)}
              aria-label="Fechar painel"
            >
              <CloseIcon size={18} />
            </button>
          </div>
          {remoteParticipants.length === 0 ? (
            <p className={styles.emptyState}>Ninguém mais na sala ainda.</p>
          ) : (
            <ul className={styles.participantList}>
              {remoteParticipants.map((participant) => (
                <ParticipantRow
                  key={participant.identity}
                  participant={participant}
                  hasScreenShareAudio={screenShareAudioIdentities.has(participant.identity)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
