'use client';

// Compartilhar o som de UM app do Linux na call.
//
// O Chrome no Linux só compartilha áudio de ABA — janela e tela cheia não têm
// som. Quem quer mandar o áudio de um jogo precisa de um dispositivo de
// ENTRADA que só contenha aquele app, e é isso que `scripts/concord-audio`
// monta no PipeWire. Aqui só capturamos esse dispositivo e publicamos.
//
// Publicar em vez de trocar o microfone é o ponto: dá pra mandar o jogo E
// continuar falando. Escolher o "Monitor of ..." como microfone, o truque
// antigo, além de tomar a voz, devolve a call inteira pra call.
//
// O ESTADO MORA NO HOOK, NÃO NA UI. O painel vive dentro do popover do chevron
// de qualidade, que desmonta ao fechar; se o `publishTrack` morasse aqui, o
// efeito de cleanup despublicaria a faixa toda vez que a pessoa fechasse o
// popover. Por isso o `useAppAudioShare` é chamado na CallControlBar, que fica
// montada a call inteira, e este componente é UI burra.

import * as React from 'react';
import { AudioPresets, Track } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { SpeakerIcon } from '@/lib/icons';
import {
  APP_AUDIO_COMMAND,
  APP_AUDIO_DEVICE_LABEL,
  APP_AUDIO_TRACK_NAME,
  isAppAudioPublication,
  pickAppAudioDevices,
} from '@/lib/appAudio';
import styles from '../styles/AppAudioControl.module.css';

export interface AppAudioShare {
  sharing: boolean;
  devices: MediaDeviceInfo[];
  error: string | null;
  refresh: () => void;
  start: (deviceId: string) => void;
  stop: () => void;
}

export function useAppAudioShare(): AppAudioShare {
  const room = useRoomContext();
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [sharing, setSharing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const trackRef = React.useRef<MediaStreamTrack | null>(null);
  // Conta os `stop()`. Serve pra um `stop()` que chegou no meio de um `start()`
  // não se perder: quando o publish termina, ele compara e desfaz.
  const stopSeqRef = React.useRef(0);
  const startingRef = React.useRef(false);

  /**
   * Despublica pelo NOME da faixa, varrendo as publicações locais.
   *
   * `unpublishTrack` com um `MediaStreamTrack` cru acha a publicação
   * comparando identidade de objeto (`localTrack.mediaStreamTrack === track`)
   * e devolve `undefined` CALADO quando não acha — além de pular a espera do
   * publish em voo, que ele só faz pra `LocalTrack`. Qualquer descasamento
   * deixava uma faixa órfã publicada, com áudio de verdade passando e sem
   * ninguém segurando a referência pra derrubar. Varrer por nome não tem esse
   * modo de falha.
   */
  const unpublishAll = React.useCallback(async () => {
    const local = room?.localParticipant;
    if (!local) {
      return;
    }
    for (const publication of local.audioTrackPublications.values()) {
      if (isAppAudioPublication(publication) && publication.track) {
        try {
          await local.unpublishTrack(publication.track, true);
        } catch {
          // Sala já caiu: a faixa morre junto. Insistir só geraria ruído.
        }
      }
    }
  }, [room]);

  const stop = React.useCallback(async () => {
    const track = trackRef.current;
    trackRef.current = null;
    stopSeqRef.current += 1;
    setSharing(false);
    await unpublishAll();
    track?.stop();
  }, [unpublishAll]);

  // Sair da call desmonta a barra. Sem isto o dispositivo ficaria ocupado.
  const stopRef = React.useRef(stop);
  stopRef.current = stop;
  React.useEffect(() => () => void stopRef.current(), []);

  const refresh = React.useCallback(() => {
    setError(null);
    // Enumera sob demanda, sem escutar `ondevicechange`: não está confirmado
    // que ele dispara no Chromium/Linux quando um source nasce, e perguntar na
    // hora torna a dúvida irrelevante.
    void navigator.mediaDevices
      .enumerateDevices()
      .catch(() => [] as MediaDeviceInfo[])
      .then((all) => setDevices(pickAppAudioDevices(all)));
  }, []);

  const start = React.useCallback(
    async (deviceId: string) => {
      // Sem esta guarda, dois cliques antes do publish terminar publicavam
      // duas faixas e a ref guardava só a última — a primeira ficava no ar
      // pra sempre.
      if (startingRef.current || trackRef.current) {
        return;
      }
      startingRef.current = true;
      const seq = stopSeqRef.current;
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
        // Alguém mandou parar enquanto o publish estava em voo (unmount,
        // `ended`, clique no botão). Sem isto a faixa nasceria órfã: o `stop()`
        // rodou antes de existir publicação pra varrer.
        if (stopSeqRef.current !== seq) {
          await unpublishAll();
          track.stop();
          return;
        }
        // Se o script morrer, o dispositivo some e a faixa termina sozinha —
        // sem isto o controle continuaria dizendo que está compartilhando.
        track.addEventListener('ended', () => void stopRef.current());
        trackRef.current = track;
        setSharing(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'não deu pra capturar o dispositivo');
      } finally {
        startingRef.current = false;
      }
    },
    [room, unpublishAll],
  );

  return {
    sharing,
    devices,
    error,
    refresh,
    start: React.useCallback((id: string) => void start(id), [start]),
    stop: React.useCallback(() => void stop(), [stop]),
  };
}

/**
 * Seção do popover do chevron, ao lado da qualidade da transmissão. Mesma
 * pergunta pra quem chega ("como mando o som do jogo?"), mesma gaveta.
 */
export function AppAudioControl(props: { share: AppAudioShare }) {
  const { sharing, devices, error, refresh, start, stop } = props.share;
  const [selected, setSelected] = React.useState('');
  // `start` faz getUserMedia + publishTrack: em maquina lenta sao alguns
  // segundos com o botao inerte e nenhum sinal de que ja comecou. A guarda
  // interna (startingRef) ja impedia publicar duas faixas, mas era invisivel.
  const [starting, setStarting] = React.useState(false);

  // O popover só existe enquanto está aberto: abrir já é o gesto de "olha de
  // novo se o dispositivo apareceu".
  React.useEffect(refresh, [refresh]);

  const current = selected || devices[0]?.deviceId || '';

  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>
        <SpeakerIcon size={16} />
        <span className={styles.labelText}>Áudio de app</span>
      </span>

      {sharing ? (
        <>
          <button type="button" className={`lk-button ${styles.action}`} onClick={stop}>
            Parar de compartilhar
          </button>
          <p className={styles.hint}>Toca só pra quem assiste.</p>
        </>
      ) : devices.length === 0 ? (
        <p className={styles.hint}>
          Sem <strong>{APP_AUDIO_DEVICE_LABEL}</strong>. Rode e reabra:
          <code className={styles.command}>{APP_AUDIO_COMMAND}</code>
        </p>
      ) : (
        <>
          <select
            className={`lk-button ${styles.select}`}
            value={current}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="Dispositivo de áudio de app"
          >
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`lk-button ${styles.action}`}
            onClick={() => {
              setStarting(true);
              void Promise.resolve(start(current)).finally(() => setStarting(false));
            }}
            disabled={!current || starting}
          >
            {starting ? 'Compartilhando…' : 'Compartilhar'}
          </button>
        </>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
