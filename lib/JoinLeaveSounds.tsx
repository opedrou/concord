'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { BellIcon, BellOffIcon } from '@/lib/icons';
import styles from '../styles/JoinLeaveSounds.module.css';

const MUTE_STORAGE_KEY = 'concord-join-leave-sound-muted';
// Intervalo minimo entre dois bipes do mesmo tipo — se varias pessoas
// entrarem/sairem quase juntas, so o primeiro soa em vez de virar rajada.
const MIN_GAP_MS = 350;
// Tempo de folga depois que a conexao fica "connected" antes de comecar a
// reagir a participantConnected/Disconnected. O SDK nao deveria disparar esse
// evento pra quem ja estava na sala no momento da conexao (fica preso a
// engine ainda "nao conectada" e e descartado), mas o atraso e uma rede de
// seguranca barata contra qualquer corrida nesse meio-tempo.
const READY_DELAY_MS = 1200;

const CHIME_PEAK_GAIN = 0.12; // volume baixo por padrao

function loadMuted(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean) {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // localStorage pode falhar (modo privado, quota etc). Sem persistencia
    // o toggle so vale pra sessao atual, o que ainda e melhor que nada.
  }
}

/** Toca um tom curto com envelope de ganho (ataque rapido, decaimento exponencial). */
function playTone(ctx: AudioContext, freq: number, startTime: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(CHIME_PEAK_GAIN, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.03);
}

/**
 * Som curto de entrada/saida de participante, estilo Discord. Sintetizado via
 * WebAudio (osciladores + envelope) em vez de arquivo de audio — evita asset
 * binario novo no repo.
 *
 * Usa um AudioContext PROPRIO, separado do audioContext interno do Room (esse
 * so existe com `webAudioMix: true` e serve pra tocar/misturar as tracks
 * remotas com boost de volume — ver ParticipantAudioPanel). Os dois contextos
 * sao independentes: nada aqui interfere na reproducao das chamadas nem no
 * slider de volume por participante.
 */
export function JoinLeaveSounds() {
  const room = useRoomContext();
  const [muted, setMuted] = React.useState(loadMuted);
  const mutedRef = React.useRef(muted);
  mutedRef.current = muted;

  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const readyRef = React.useRef(false);
  const lastJoinAtRef = React.useRef(0);
  const lastLeaveAtRef = React.useRef(0);

  const getAudioContext = React.useCallback((): AudioContext | null => {
    if (audioCtxRef.current) {
      return audioCtxRef.current;
    }
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        return null;
      }
      audioCtxRef.current = new Ctor();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const playChime = React.useCallback(
    (ascending: boolean) => {
      if (mutedRef.current) {
        return;
      }
      const ctx = getAudioContext();
      if (!ctx) {
        return;
      }
      const fire = () => {
        const now = ctx.currentTime;
        const [f1, f2] = ascending ? [660, 880] : [880, 660];
        playTone(ctx, f1, now, 0.12);
        playTone(ctx, f2, now + 0.09, 0.14);
      };
      if (ctx.state === 'suspended') {
        // Politica de autoplay: o AudioContext so toca depois de um gesto do
        // usuario. Clicar pra entrar no canal ja conta como gesto, mas se o
        // resume falhar mesmo assim (aba em background, navegador teimoso),
        // so deixamos de tocar o som — sem quebrar o resto do app.
        ctx.resume().then(fire).catch(() => {});
      } else {
        fire();
      }
    },
    [getAudioContext],
  );

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

    const handleParticipantConnected = () => {
      if (!readyRef.current) {
        return;
      }
      const now = Date.now();
      if (now - lastJoinAtRef.current < MIN_GAP_MS) {
        return;
      }
      lastJoinAtRef.current = now;
      playChime(true);
    };

    const handleParticipantDisconnected = () => {
      if (!readyRef.current) {
        return;
      }
      const now = Date.now();
      if (now - lastLeaveAtRef.current < MIN_GAP_MS) {
        return;
      }
      lastLeaveAtRef.current = now;
      playChime(false);
    };

    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

    return () => {
      if (readyTimeout) {
        clearTimeout(readyTimeout);
      }
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, playChime]);

  // Fecha o AudioContext proprio ao desmontar, pra nao vazar recurso.
  React.useEffect(() => {
    return () => {
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const toggleMuted = React.useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      saveMuted(next);
      return next;
    });
  }, []);

  return (
    <button
      type="button"
      className={`lk-button ${styles.toggleButton}`}
      onClick={toggleMuted}
      aria-pressed={muted}
      title={muted ? 'Ativar som de entrada/saída de participantes' : 'Silenciar som de entrada/saída de participantes'}
    >
      {muted ? <BellOffIcon size={18} /> : <BellIcon size={18} />}
    </button>
  );
}
