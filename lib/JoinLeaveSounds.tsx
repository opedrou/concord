'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type {
  LocalTrackPublication,
  RemoteTrackPublication,
  RemoteParticipant,
} from 'livekit-client';
import { closeSfxContextSoon, playSfx, preloadSfx } from '@/lib/sfx';
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
 * Reage a participante remoto E as proprias quatro acoes (entrar, sair,
 * comecar a transmitir, parar de transmitir):
 *
 * - O de entrada da propria pessoa toca assim que a sala fica "connected" (ou
 *   na hora se o componente ja monta com a sala conectada), sem esperar o
 *   `armReadyTimer` — esse temporizador existe pra nao anunciar quem JA
 *   estava na sala quando voce chega, nao pra atrasar o aviso da sua propria
 *   entrada.
 * - O de comecar a transmitir soa junto com o fechamento da caixinha de
 *   selecao de tela do navegador. E esperado e foi aceito.
 * - O de sair toca no cleanup do efeito de eventos (agora que trocar de canal
 *   e um unmount de componente, nao mais um reload de pagina — ver
 *   lib/RoomShell.tsx) e o fechamento do AudioContext dos efeitos, logo
 *   abaixo, e adiado pra dar tempo do som terminar antes do contexto fechar.
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

  /** Toca respeitando o mute e o intervalo minimo POR SOM, mas SEM esperar o
   * temporizador de prontidao — pras quatro acoes que sao a MINHA propria (a
   * gente sabe de cara que acabou de acontecer, nao tem "salva de estado
   * antigo" pra filtrar). Le a preferencia na hora (nao pela prop reativa) pra
   * o callback poder ter deps vazias e nao reassinar os eventos do Room a
   * cada ajuste de volume. */
  const playRaw = React.useCallback((url: string) => {
    const { muted: isMuted, volume } = getSoundPrefs();
    if (isMuted) {
      return;
    }
    const now = Date.now();
    if (now - (lastPlayedAtRef.current[url] ?? 0) < MIN_GAP_MS) {
      return;
    }
    lastPlayedAtRef.current[url] = now;
    playSfx(url, { gain: volume });
  }, []);

  /** Mesma coisa, mas SO depois do temporizador de prontidao — pros eventos
   * de participante REMOTO, que podem ser so o SDK entregando o estado atual
   * da sala (ver READY_DELAY_MS acima). */
  const play = React.useCallback(
    (url: string) => {
      if (!readyRef.current) {
        return;
      }
      playRaw(url);
    },
    [playRaw],
  );

  React.useEffect(() => {
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    readyRef.current = false;
    // Garante que o som de entrada da PROPRIA pessoa toca uma unica vez por
    // montagem, mesmo que `handleConnected` dispare de novo numa reconexao.
    let playedOwnJoin = false;
    const playOwnJoinOnce = () => {
      if (playedOwnJoin) {
        return;
      }
      playedOwnJoin = true;
      playRaw(SOUND_JOIN);
    };

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
    // temporizador na hora e toca o som de entrada. Senao, espera o evento
    // Connected.
    if (room.state === ConnectionState.Connected) {
      armReadyTimer();
      playOwnJoinOnce();
    }

    const handleConnected = () => {
      armReadyTimer();
      playOwnJoinOnce();
    };
    const handleParticipantConnected = () => play(SOUND_JOIN);
    const handleParticipantDisconnected = () => play(SOUND_LEAVE);
    // Screen share da PROPRIA pessoa: toca junto com o fechamento da caixinha
    // de selecao de tela do navegador — esperado, ver comentario no topo.
    const handleLocalTrackPublished = (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        playRaw(SOUND_STREAM_START);
      }
    };
    const handleLocalTrackUnpublished = (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.ScreenShare) {
        playRaw(SOUND_STREAM_STOP);
      }
    };

    // Os dois handlers de tela recebem a publicacao e o participante; so
    // interessa screen share de gente remota — a propria (acima,
    // handleLocalTrackPublished/Unpublished) usa os eventos Local* dedicados,
    // que carregam LocalTrackPublication em vez de RemoteTrackPublication.
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
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

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
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
      // Som de SAIDA da propria pessoa — toca aqui, e nao num evento do Room,
      // porque sair do canal e ISTO: o desmonte deste componente (RoomShell
      // troca de canal com `key={roomName}`, ver lib/RoomShell.tsx, entao nao
      // e mais um reload de pagina que mataria a call antes do som sair).
      playRaw(SOUND_LEAVE);
    };
  }, [room, play, playRaw]);

  // Fecha o AudioContext dos efeitos ao sair da call, pra nao vazar recurso.
  // O adiamento (e o cancelamento dele quando isto remonta na troca de canal)
  // mora em lib/sfx.ts, que e o dono do recurso.
  React.useEffect(() => {
    return () => {
      closeSfxContextSoon();
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
