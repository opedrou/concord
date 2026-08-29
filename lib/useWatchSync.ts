'use client';

// Liga o protocolo do watch together (lib/watchSync.ts) no LiveKit: comandos
// pelo data channel, estado por atributo de participante. Não conhece player
// nenhum — recebe a interface `WatchPlayer` e o W2/W4 implementa ela com o
// iframe do YouTube ou o <video> do Jellyfin.
//
// DATA CHANNEL É EVENTO, ATRIBUTO É ESTADO
// ----------------------------------------
// Mesmo desenho do lib/useScreenShareViewers.ts, e pelo mesmo motivo: quem
// entra na sala depois não recebe as mensagens que já passaram. Então quem está
// numa sessão de watch publica a linha do tempo em `concord.watchSession`, e o
// retardatário lê o atributo do host e se posiciona. Exige o grant
// `canUpdateOwnMetadata` no token, que todo mundo já tem
// (app/api/connection-details/route.ts).
//
// NINGUÉM É O RELÓGIO — O RELÓGIO É O RELÓGIO
// -------------------------------------------
// A tentação é eleger um host e fazer todo mundo seguir a posição real do
// player DELE. Não: se o host bufferiza ou pega anúncio, o filme para pra
// todo mundo, o oposto da decisão do Pedro ("a linha do tempo do grupo
// continua correndo, quem sai do anúncio pula pra onde o grupo está"). Aqui a
// linha do tempo corre sozinha no relógio e TODO MUNDO, host incluído, corrige
// o próprio player em direção a ela. O host só existe pra duas coisas
// redundantes: mandar o heartbeat e ser o atributo que o retardatário lê. Por
// isso a troca de host (`pickHost`) não precisa de negociação nem de handoff.

import * as React from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { useDataChannel, useRoomContext } from '@livekit/components-react';
import {
  DRIFT_CHECK_MS,
  HEARTBEAT_MS,
  WATCH_ATTRIBUTE,
  WATCH_TOPIC,
  type WatchMessage,
  type WatchMessageType,
  type WatchTimeline,
  correction,
  isRedundant,
  parseWatchMessage,
  pickHost,
  positionAt,
  timelineFromMessage,
} from './watchSync';

/**
 * O mínimo que o protocolo precisa de um player. Duas implementações estão
 * previstas (iframe do YouTube no W4, <video> do Jellyfin no W3), então a
 * interface não é abstração pra um caso só.
 */
export interface WatchPlayer {
  /** Posição atual em ms, ou `null` enquanto o player não souber. */
  positionMs(): number | null;
  seek(positionMs: number): void;
  play(): void;
  pause(): void;
  setRate(rate: number): void;
}

export interface WatchEvent {
  by: string;
  type: WatchMessageType;
  at: number;
}

/**
 * Depois de um seek o `positionMs()` do player ainda devolve o valor velho por
 * um tempo (ele bufferiza). Sem essa carência, o tick seguinte veria o drift
 * inteiro de novo e mandaria outro seek — e o vídeo ficaria pulando.
 */
const SEEK_SETTLE_MS = 1500;

/** Atributo trafega pela sinalização; sem debounce um arrastar de barra vira rajada. */
const PUBLISH_DEBOUNCE_MS = 300;

/** Janela em que um encerramento ignora sessão vinda de atributo alheio. */
const STOP_QUIET_MS = 5000;

function parseAttribute(value: string | undefined): WatchTimeline | null {
  if (!value) {
    return null;
  }
  const message = parseWatchMessage(value);
  return message ? timelineFromMessage(message) : null;
}

export interface UseWatchSync {
  /** A linha do tempo do grupo, ou `null` quando não há sessão. */
  timeline: WatchTimeline | null;
  /** Se este cliente é quem manda o heartbeat agora. Só pra diagnóstico. */
  isHost: boolean;
  lastEvent: WatchEvent | null;
  /** Abre a sessão. `positionMs` numa live é `liveTargetMs(borda)`. */
  start: (src: string, positionMs?: number) => void;
  /** Encerra pra todo mundo. */
  stop: () => void;
  play: () => void;
  pause: () => void;
  seek: (positionMs: number) => void;
  setRate: (rate: number) => void;
}

export function useWatchSync(player: WatchPlayer | null): UseWatchSync {
  const room = useRoomContext();
  const [timeline, setTimeline] = React.useState<WatchTimeline | null>(null);
  const [isHost, setIsHost] = React.useState(false);
  const [lastEvent, setLastEvent] = React.useState<WatchEvent | null>(null);

  // Só pode ser host quem (a) confirmou a própria escrita de atributo e (b)
  // tem a linha do tempo ancorada no PRÓPRIO relógio — porque foi ele quem
  // mandou o comando, ou porque recebeu uma mensagem ao vivo e reancorou.
  // Quem adotou a sessão lendo um atributo está usando o `atEpochMs` de outra
  // máquina; se essa pessoa virasse host, ela passaria a impor a conversão
  // errada dela pra todo mundo no heartbeat seguinte — e um relógio 30s torto
  // faria o filme pular meio minuto pra sala inteira. Ela vira elegível assim
  // que a primeira mensagem ao vivo chegar.
  const [locallyAnchored, setLocallyAnchored] = React.useState(false);
  const [attributeOk, setAttributeOk] = React.useState(false);

  // Refs pra o loop de drift e o handler do canal não dependerem de render.
  const playerRef = React.useRef(player);
  playerRef.current = player;
  const timelineRef = React.useRef<WatchTimeline | null>(null);
  const appliedPlayingRef = React.useRef<boolean | null>(null);
  const appliedRateRef = React.useRef<number | null>(null);
  const seekSettleUntilRef = React.useRef(0);
  const consecutiveSeeksRef = React.useRef(0);
  /**
   * Até quando ignorar sessão vinda de atributo. Sem isso o encerrar não
   * encerra: quem clica zera a linha do tempo, o efeito de eleição re-roda na
   * hora, e o atributo dos outros AINDA tem a sessão (debounce de 300ms mais o
   * tempo de ida) — então ele readota na mesma hora o que acabou de fechar, e
   * o outro faz o mesmo com o dele. O filme não fechava pra ninguém.
   */
  const stoppedUntilRef = React.useRef(0);

  const adopt = React.useCallback((next: WatchTimeline | null) => {
    timelineRef.current = next;
    setTimeline(next);
  }, []);

  // --- Reconciliação: aproxima ESTE player da linha do tempo do grupo -------
  const reconcile = React.useCallback(() => {
    const current = timelineRef.current;
    const target = playerRef.current;
    if (!target) {
      return;
    }
    if (!current) {
      // Sessão encerrada: para o player e esquece o que já foi aplicado.
      if (appliedPlayingRef.current) {
        target.pause();
      }
      appliedPlayingRef.current = null;
      appliedRateRef.current = null;
      return;
    }

    // Reaplicado a CADA tick, não só quando muda. Play e pause são
    // idempotentes, e confiar em "só quando muda" deixava o player preso
    // quando algo o parava por fora: o controle nativo do YouTube, ou o
    // bloqueio de autoplay — que é garantido pra quem chega no meio, porque
    // esse adota a sessão lendo um atributo, sem gesto do usuário nenhum.
    // O sintoma era o vídeo travado enquanto a barra pulava sozinha.
    if (current.playing) {
      target.play();
    } else {
      target.pause();
    }

    const now = Date.now();
    if (now < seekSettleUntilRef.current) {
      return;
    }
    const actual = target.positionMs();
    if (actual === null) {
      return;
    }

    const fix = correction(positionAt(current, now), actual, current.rate, current.playing);
    if (fix.action === 'seek') {
      target.seek(fix.positionMs);
      // Backoff. Medido na sonda de 2026-08-29: perto da borda de uma live o
      // seek erra 2,8s — mais que o DRIFT_SEEK_MS que o dispara. Sem dobrar a
      // carência, o tick seguinte veria o mesmo drift e mandaria outro seek,
      // e o vídeo travaria e pularia a cada 1,5s indefinidamente. Mesma coisa
      // no fim do vídeo (o player clampa) e durante anúncio (o seek não pega).
      consecutiveSeeksRef.current = Math.min(consecutiveSeeksRef.current + 1, 3);
      seekSettleUntilRef.current = now + SEEK_SETTLE_MS * 2 ** (consecutiveSeeksRef.current - 1);
      return;
    }
    consecutiveSeeksRef.current = 0;
    if (fix.action === 'rate' && fix.rate !== appliedRateRef.current) {
      appliedRateRef.current = fix.rate;
      target.setRate(fix.rate);
    }
  }, []);

  // --- Recebimento ---------------------------------------------------------
  const handleMessage = React.useCallback(
    (msg: { payload: Uint8Array; from?: { identity: string; name?: string } }) => {
      const message = parseWatchMessage(new TextDecoder().decode(msg.payload));
      if (!message) {
        return;
      }
      // Só comando vira evento de UI. Heartbeat não é "fulano fez algo", e
      // registrá-lo seria um re-render a cada 3s pra dizer nada.
      if (message.type !== 'hb') {
        const by = msg.from?.name || msg.from?.identity || 'alguém';
        setLastEvent({ by, type: message.type, at: Date.now() });
      }

      if (message.type === 'stop') {
        stoppedUntilRef.current = Date.now() + STOP_QUIET_MS;
        setLocallyAnchored(false);
        adopt(null);
        reconcile();
        return;
      }

      // Reancora no relógio local — o `atEpochMs` que veio é de outra máquina.
      // Ver o comentário do topo de watchSync.ts.
      const now = Date.now();
      const incoming = timelineFromMessage(message, now);
      const current = timelineRef.current;

      // Heartbeat que só repete o que já sabemos não vira estado novo: ele
      // reescreveria o atributo e re-renderizaria tudo a cada 3s à toa. O
      // player continua sendo corrigido pelo loop de drift, que não depende
      // disto. Comando (play/pause/seek/rate) passa sempre — mesmo "igual",
      // ele é a intenção de alguém e o `by` alimenta a UI.
      if (message.type === 'hb' && current && isRedundant(current, incoming, now)) {
        return;
      }

      setLocallyAnchored(true);
      adopt(incoming);
      reconcile();
    },
    [adopt, reconcile],
  );

  const { send } = useDataChannel(WATCH_TOPIC, handleMessage);

  // --- Envio ---------------------------------------------------------------
  const publish = React.useCallback(
    (type: WatchMessageType, next: WatchTimeline | null) => {
      const payload: WatchMessage = {
        type,
        by: room?.localParticipant.name || room?.localParticipant.identity || 'alguém',
        src: next?.src ?? '',
        playing: next?.playing ?? false,
        positionMs: next?.positionMs ?? 0,
        atEpochMs: next?.atEpochMs ?? Date.now(),
        rate: next?.rate ?? 1,
      };
      // Tudo `reliable`, heartbeat incluído. A tentação é mandar o heartbeat
      // sem garantia (o próximo vem em 3s), mas reliable e lossy são dois
      // DataChannel SCTP distintos, sem ordenação entre si: o heartbeat pelo
      // canal rápido ultrapassaria um `pause` que está sendo retransmitido no
      // canal confiável, e como ele carrega `playing: true` despausaria quem
      // já tinha pausado. Uma mensagem a cada 3s não custa nada.
      void send(new TextEncoder().encode(JSON.stringify(payload)), {
        reliable: true,
      }).catch(() => {
        // Sem canal de dados. Quem mandou continua com o próprio player certo;
        // é o mesmo tratamento da soundboard.
      });
    },
    [room, send],
  );

  /** Aplica localmente sem esperar eco (o `send` não volta pra quem enviou). */
  const command = React.useCallback(
    (type: WatchMessageType, next: WatchTimeline | null) => {
      setLocallyAnchored(next !== null);
      adopt(next);
      publish(type, next);
      reconcile();
    },
    [adopt, publish, reconcile],
  );

  const start = React.useCallback(
    (src: string, positionMs = 0) => {
      command('play', { src, playing: true, positionMs, atEpochMs: Date.now(), rate: 1 });
    },
    [command],
  );

  const stop = React.useCallback(() => {
    stoppedUntilRef.current = Date.now() + STOP_QUIET_MS;
    setLocallyAnchored(false);
    command('stop', null);
  }, [command]);

  /** Recalcula a linha do tempo a partir de onde o grupo está AGORA. */
  const rebase = React.useCallback(
    (type: WatchMessageType, patch: Partial<WatchTimeline>) => {
      const current = timelineRef.current;
      if (!current) {
        return;
      }
      const now = Date.now();
      command(type, {
        ...current,
        positionMs: positionAt(current, now),
        atEpochMs: now,
        ...patch,
      });
    },
    [command],
  );

  const play = React.useCallback(() => rebase('play', { playing: true }), [rebase]);
  const pause = React.useCallback(() => rebase('pause', { playing: false }), [rebase]);
  const seek = React.useCallback((positionMs: number) => rebase('seek', { positionMs }), [rebase]);
  const setRate = React.useCallback((rate: number) => rebase('rate', { rate }), [rebase]);

  // --- Loop de drift -------------------------------------------------------
  React.useEffect(() => {
    const timer = setInterval(reconcile, DRIFT_CHECK_MS);
    return () => clearInterval(timer);
  }, [reconcile]);

  // --- Escrita do atributo: "eu estou nesta sessão, e ela está aqui" -------
  const attributePayload = timeline
    ? JSON.stringify({ type: 'hb' satisfies WatchMessageType, by: '', ...timeline })
    : '';
  React.useEffect(() => {
    if (!room) {
      return;
    }
    const publishAttribute = () => {
      if (room.state !== ConnectionState.Connected) {
        return;
      }
      // `setAttributes` faz merge — não atropela `concord.watching` nem
      // `concord.focus`.
      room.localParticipant
        .setAttributes({ [WATCH_ATTRIBUTE]: attributePayload })
        .then(() => setAttributeOk(true))
        .catch(() => {
          // Sem o grant `canUpdateOwnMetadata` cai aqui. A sessão continua
          // funcionando pra quem já está nela; só o retardatário fica sem
          // estado. Marcar a falha importa pra eleição: se o atributo não
          // propaga, cada um enxerga só a si mesmo como candidato e TODOS se
          // acham host. Aí cada heartbeat reancora no relógio de quem recebe,
          // e com o relay mútuo a latência de ida deixa de ser um deslocamento
          // fixo e vira atraso acumulado — o filme arrastando pra trás sem
          // parar. Sem escrita confirmada, ninguém se candidata.
          setAttributeOk(false);
        });
    };
    const timer = setTimeout(publishAttribute, PUBLISH_DEBOUNCE_MS);
    // Atributo não sobrevive a reconexão.
    room.on(RoomEvent.Connected, publishAttribute);
    room.on(RoomEvent.Reconnected, publishAttribute);
    return () => {
      clearTimeout(timer);
      room.off(RoomEvent.Connected, publishAttribute);
      room.off(RoomEvent.Reconnected, publishAttribute);
    };
  }, [room, attributePayload]);

  // --- Leitura do atributo: quem é o host, e o que o retardatário adota ----
  const inSession = timeline !== null;
  React.useEffect(() => {
    if (!room) {
      return;
    }
    const recompute = () => {
      const candidates: string[] = [];
      const byIdentity = new Map<string, WatchTimeline>();
      if (inSession && locallyAnchored && attributeOk) {
        candidates.push(room.localParticipant.identity);
      }
      for (const remote of room.remoteParticipants.values()) {
        const remoteTimeline = parseAttribute(remote.attributes?.[WATCH_ATTRIBUTE]);
        if (remoteTimeline) {
          candidates.push(remote.identity);
          byIdentity.set(remote.identity, remoteTimeline);
        }
      }
      const host = pickHost(candidates);
      setIsHost(host !== null && host === room.localParticipant.identity);

      // Retardatário: sem linha do tempo local, adota a do host. Aqui o
      // `atEpochMs` do outro é usado como está — não há instante de chegada.
      // Se os relógios discordarem, o primeiro heartbeat conserta com um seek.
      if (!inSession && host && Date.now() >= stoppedUntilRef.current) {
        const adopted = byIdentity.get(host);
        if (adopted) {
          // `locallyAnchored` continua false de propósito: esta linha do tempo
          // veio do relógio de outra máquina, então quem a adotou não pode
          // virar host até receber uma mensagem ao vivo.
          adopt(adopted);
          reconcile();
        }
      }
    };

    const events: RoomEvent[] = [
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const event of events) {
      room.on(event, recompute);
    }
    recompute();
    return () => {
      for (const event of events) {
        room.off(event, recompute);
      }
    };
  }, [room, inSession, locallyAnchored, attributeOk, adopt, reconcile]);

  // --- Heartbeat do host ---------------------------------------------------
  React.useEffect(() => {
    if (!isHost || !inSession) {
      return;
    }
    const beat = () => {
      const current = timelineRef.current;
      if (!current) {
        return;
      }
      const now = Date.now();
      // Reanuncia a MESMA linha do tempo, só reancorada: o heartbeat é
      // redundância (pacote perdido, retardatário), não uma nova verdade.
      publish('hb', { ...current, positionMs: positionAt(current, now), atEpochMs: now });
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [isHost, inSession, publish]);

  // Memoizado porque o consumidor natural é o CallStage, que repassa isto pra
  // baixo: sem o memo, um objeto novo a cada render anularia o React.memo de
  // quem receber o hook inteiro como prop (mesmo cuidado do ChannelSidebar).
  return React.useMemo(
    () => ({ timeline, isHost, lastEvent, start, stop, play, pause, seek, setRate }),
    [timeline, isHost, lastEvent, start, stop, play, pause, seek, setRate],
  );
}
