'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import { closeSfxContext, playSfx, preloadSfx } from '@/lib/sfx';
import { getSoundPrefs, setSoundMuted, setSoundVolume, useSoundPrefs } from '@/lib/soundPrefs';
import windowStyles from '../styles/SettingsWindow.module.css';

// Intervalo minimo entre dois sons do mesmo tipo — se varias pessoas
// entrarem/sairem quase juntas, so o primeiro soa em vez de virar rajada.
const MIN_GAP_MS = 350;
// Tempo de folga depois que a conexao fica "connected" antes de comecar a
// reagir aos eventos. Vale pros quatro sons: ao entrar num canal, o SDK
// entrega o estado atual da sala (quem ja estava dentro, quem ja estava
// transmitindo), e sem essa folga voce ouviria uma salva de sons anunciando
// coisas que nao acabaram de acontecer.
const READY_DELAY_MS = 1200;

// Arquivos reais (os mesmos do Discord), em public/sounds. Antes estes sons
// eram sintetizados com osciladores pra evitar asset binario no repo; agora
// que os arquivos existem, sintetizar so deixava o app com cara de prototipo.
const SOUND_JOIN = '/sounds/join.mp3';
const SOUND_LEAVE = '/sounds/leave.mp3';
const SOUND_STREAM_START = '/sounds/stream-start.mp3';
const SOUND_STREAM_STOP = '/sounds/stream-stop.mp3';
const ALL_SOUNDS = [SOUND_JOIN, SOUND_LEAVE, SOUND_STREAM_START, SOUND_STREAM_STOP] as const;

/**
 * Sons de presenca da call, estilo Discord: alguem entrou, alguem saiu,
 * alguem comecou a transmitir, alguem parou.
 *
 * So reage a participante REMOTO. Voce nao precisa de um som pra descobrir
 * que voce mesmo entrou no canal ou apertou "compartilhar tela" — e no caso
 * da transmissao isso seria pior que inutil, porque o som dispararia junto com
 * o fechamento da caixinha de selecao de tela do navegador.
 *
 * O audio em si mora em lib/sfx.ts, num AudioContext separado do da chamada —
 * ver o porque no topo daquele arquivo.
 *
 * Componente SEM UI, montado junto dos outros binders no PageClientImpl: ele
 * precisa do RoomContext pros eventos, mas nao desenha nada.
 */
export function JoinLeaveSounds() {
  const room = useRoomContext();
  // Preferencias vem da store compartilhada (lib/soundPrefs.ts): o mesmo
  // valor e editavel aqui e na secao "Notificacoes" da janela de
  // configuracoes, que nao se enxergam pela arvore.
  const readyRef = React.useRef(false);
  const lastPlayedAtRef = React.useRef<Record<string, number>>({});

  React.useEffect(() => {
    preloadSfx(ALL_SOUNDS);
  }, []);

  /** Toca respeitando o mute e o intervalo minimo POR SOM. Le a preferencia
   * na hora (nao pela prop reativa) pra o callback poder ter deps vazias e nao
   * reassinar os eventos do Room a cada ajuste de volume. */
  const play = React.useCallback((url: string) => {
    const { muted: isMuted, volume } = getSoundPrefs();
    if (isMuted || !readyRef.current) {
      return;
    }
    const now = Date.now();
    if (now - (lastPlayedAtRef.current[url] ?? 0) < MIN_GAP_MS) {
      return;
    }
    lastPlayedAtRef.current[url] = now;
    playSfx(url, { gain: volume });
  }, []);

  React.useEffect(() => {
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    readyRef.current = false;

    const armReadyTimer = () => {
      if (readyTimeout) {
        return;
      }
      readyTimeout = setTimeout(() => {
        readyRef.current = true;
      }, READY_DELAY_MS);
    };

    // Se o componente monta com a sala ja conectada (caso comum: o Room e
    // criado e conecta antes do React terminar de montar a arvore), arma o
    // temporizador na hora. Senao, espera o evento Connected.
    if (room.state === ConnectionState.Connected) {
      armReadyTimer();
    }

    const handleConnected = () => armReadyTimer();
    const handleParticipantConnected = () => play(SOUND_JOIN);
    const handleParticipantDisconnected = () => play(SOUND_LEAVE);

    // Os dois handlers de tela recebem a publicacao e o participante; so
    // interessa screen share de gente remota. O tipo dos parametros vem do
    // proprio RoomEvent (TrackPublished/TrackUnpublished sao sempre remotos —
    // os locais tem eventos proprios, que de proposito NAO escutamos aqui).
    const handleTrackPublished = (publication: RemoteTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        play(SOUND_STREAM_START);
      }
    };
    const handleTrackUnpublished = (publication: RemoteTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        play(SOUND_STREAM_STOP);
      }
    };
    // Sair da sala no meio de uma transmissao nao dispara TrackUnpublished —
    // sem isto, a transmissao sumiria da tela em silencio.
    const handleParticipantLeftWhileSharing = (participant: RemoteParticipant) => {
      if (participant.getTrackPublication(Track.Source.ScreenShare)) {
        play(SOUND_STREAM_STOP);
      }
    };

    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantLeftWhileSharing);
    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    room.on(RoomEvent.TrackUnpublished, handleTrackUnpublished);

    return () => {
      if (readyTimeout) {
        clearTimeout(readyTimeout);
      }
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantLeftWhileSharing);
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
      room.off(RoomEvent.TrackUnpublished, handleTrackUnpublished);
    };
  }, [room, play]);

  // Fecha o AudioContext dos efeitos ao sair da call, pra nao vazar recurso.
  React.useEffect(() => {
    return () => {
      closeSfxContext();
    };
  }, []);

  // SEM UI. O liga/desliga e o volume moram na secao "Notificacoes" da janela
  // de configuracoes (ver JoinLeaveSoundsSettings, no fim deste arquivo) — a
  // barra de controles tinha um sino que era so isso, e um botao permanente
  // pra uma preferencia que se mexe uma vez na vida nao pagava o espaco.
  return null;
}

/**
 * Seção "Notificações" da janela de configurações. Mexe nas MESMAS
 * preferências do botão de sino da barra de controles (ver lib/soundPrefs.ts)
 * — os dois ficam em sincronia sem recarregar a página.
 *
 * Vive fora do RoomContext de propósito: preferência de som não depende de
 * estar numa chamada.
 */
export function JoinLeaveSoundsSettings() {
  const { muted, volume } = useSoundPrefs();

  return (
    <div className={windowStyles.field}>
      <span className={windowStyles.fieldLabel}>Sons de presença</span>

      <label className={windowStyles.checkboxRow}>
        <input
          type="checkbox"
          checked={!muted}
          onChange={(e) => setSoundMuted(!e.target.checked)}
        />
        <span>Tocar som quando alguém entra, sai ou começa a transmitir</span>
      </label>

      <label className={windowStyles.fieldLabel} htmlFor="sound-volume">
        <span>Volume dos sons</span>
        <span className={windowStyles.fieldValue}>{Math.round(volume * 100)}%</span>
      </label>
      <input
        id="sound-volume"
        className={windowStyles.plainRange}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        disabled={muted}
        onChange={(e) => setSoundVolume(Number(e.target.value))}
        aria-label="Volume dos sons de presença"
      />

      <div className={windowStyles.soundPreview}>
        <button
          type="button"
          className="lk-button"
          onClick={() => playSfx(SOUND_JOIN, { gain: volume })}
          disabled={muted}
        >
          Ouvir entrada
        </button>
        <button
          type="button"
          className="lk-button"
          onClick={() => playSfx(SOUND_STREAM_START, { gain: volume })}
          disabled={muted}
        >
          Ouvir transmissão
        </button>
      </div>
      <p className={windowStyles.hint}>
        Esses sons são só pra você — ninguém mais ouve, e nada disso sai no seu microfone.
      </p>
    </div>
  );
}
