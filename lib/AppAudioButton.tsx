'use client';

// Botão de "compartilhar o áudio de um app" (Linux).
//
// O Chrome no Linux só compartilha áudio de ABA — janela e tela cheia não têm
// som. Quem quer mandar o áudio de um jogo precisa de um dispositivo de
// ENTRADA que só contenha aquele app, e é isso que `scripts/concord-audio`
// monta no PipeWire. Aqui só capturamos esse dispositivo e publicamos.
//
// Publicar em vez de trocar o microfone é o ponto: dá pra mandar o jogo E
// continuar falando. Escolher o "Monitor of ..." como microfone, o truque
// antigo, além de tomar a voz, devolve a call inteira pra call.

import * as React from 'react';
import { AudioPresets, Track } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { SpeakerIcon } from '@/lib/icons';
import {
  APP_AUDIO_COMMAND,
  APP_AUDIO_DEVICE_LABEL,
  APP_AUDIO_TRACK_NAME,
  pickAppAudioDevices,
} from '@/lib/appAudio';
import styles from '../styles/AppAudioButton.module.css';

export function AppAudioButton() {
  const room = useRoomContext();
  const [open, setOpen] = React.useState(false);
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [sharing, setSharing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const trackRef = React.useRef<MediaStreamTrack | null>(null);

  const stop = React.useCallback(async () => {
    const track = trackRef.current;
    trackRef.current = null;
    setSharing(false);
    if (!track) {
      return;
    }
    try {
      await room?.localParticipant.unpublishTrack(track, true);
    } catch {
      // Sala já caiu: a faixa morre junto, e insistir só geraria ruído no
      // console. O `stop()` abaixo é o que realmente solta o dispositivo.
    }
    track.stop();
  }, [room]);

  // Sair da call desmonta esta barra. Sem isto o `pw-loopback` continuaria
  // alimentando uma captura viva, e o dispositivo ficaria ocupado.
  const stopRef = React.useRef(stop);
  stopRef.current = stop;
  React.useEffect(() => () => void stopRef.current(), []);

  const start = React.useCallback(
    async (deviceId: string) => {
      setError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            // Os três defaults do Chrome são feitos pra VOZ e mutilam áudio de
            // jogo: o AGC fica bombeando, o supressor de ruído come transiente
            // e o cancelador de eco mexe no que já é um sinal limpo.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
          },
        });
        const track = stream.getAudioTracks()[0];
        if (!track) {
          throw new Error('o dispositivo não entregou nenhuma faixa de áudio');
        }
        await room.localParticipant.publishTrack(track, {
          source: Track.Source.Unknown,
          name: APP_AUDIO_TRACK_NAME,
          // O default do Opus é pensado pra voz mono. `dtx: false` e `red:
          // true` já vêm do `publishDefaults` da sala (ver PageClientImpl).
          audioPreset: AudioPresets.musicHighQualityStereo,
          forceStereo: true,
        });
        // Se o script morrer, o dispositivo some e a faixa termina sozinha —
        // sem isto o botão continuaria aceso dizendo que está compartilhando.
        track.addEventListener('ended', () => void stopRef.current());
        trackRef.current = track;
        setSharing(true);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'não deu pra capturar o dispositivo');
      }
    },
    [room],
  );

  const handleClick = React.useCallback(async () => {
    if (sharing) {
      await stop();
      return;
    }
    if (open) {
      setOpen(false);
      return;
    }
    setError(null);
    // Enumera no clique, sem escutar `ondevicechange`: não está confirmado que
    // ele dispara no Chromium/Linux quando um source nasce, e perguntar na
    // hora torna a dúvida irrelevante.
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setDevices(pickAppAudioDevices(all));
    setOpen(true);
  }, [open, sharing, stop]);

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={`lk-button ${styles.button}`}
        data-concord-sharing={sharing || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={sharing ? 'Parar de compartilhar o áudio do app' : 'Compartilhar o áudio de um app'}
        onClick={() => void handleClick()}
      >
        <SpeakerIcon size={18} />
      </button>

      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.panel} role="dialog" aria-label="Áudio de app">
            <p className={styles.title}>Áudio de app</p>
            {devices.length === 0 ? (
              <p className={styles.hint}>
                Nenhum dispositivo <strong>{APP_AUDIO_DEVICE_LABEL}</strong>. Rode isto num
                terminal, escolha o app, e clique aqui de novo:
                <code className={styles.command}>{APP_AUDIO_COMMAND}</code>
              </p>
            ) : (
              devices.map((device) => (
                <button
                  key={device.deviceId}
                  type="button"
                  className={styles.deviceButton}
                  onClick={() => void start(device.deviceId)}
                >
                  {device.label}
                </button>
              ))
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
