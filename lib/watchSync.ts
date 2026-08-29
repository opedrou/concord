// Protocolo de sincronia do watch together (W1). Só a lógica: relógio,
// posição-alvo, correção de drift e eleição de quem manda o heartbeat. Nada de
// React, nada de LiveKit, nada de player — por isso dá pra testar de verdade
// (ver watchSync.test.ts). Quem liga isso no data channel é useWatchSync.ts;
// quem liga num player é o W2/W4.
//
// A IDEIA: UMA MENSAGEM É UM ESTADO ABSOLUTO, NÃO UM DELTA
// -------------------------------------------------------
// O plano pedia `{ type: 'play'|'pause'|'seek'|'rate', positionMs, atEpochMs }`.
// Aqui toda mensagem carrega a linha do tempo INTEIRA (`playing`, `positionMs`,
// `atEpochMs`, `rate`), e o `type` só diz por que ela existe. Com isso não há
// máquina de estado que possa divergir: play, pause, seek, rate, heartbeat e o
// estado que o retardatário lê do atributo são todos a mesma coisa, aplicada do
// mesmo jeito. Uma mensagem perdida não deixa ninguém torto pra sempre — a
// próxima conserta.
//
// POR QUE O `atEpochMs` NÃO É USADO PARA MENSAGEM QUE CHEGA AO VIVO
// ----------------------------------------------------------------
// `atEpochMs` é o instante a que `positionMs` se refere. Só que ele vem do
// `Date.now()` de OUTRA máquina, e relógios de navegador discordam em segundos
// — usá-lo direto colocaria essa discordância inteira dentro da sincronia. Para
// mensagem que chega pelo data channel a gente reancora no relógio de QUEM
// RECEBE (`timelineFromMessage` com `receivedAtEpochMs`): o erro passa a ser a
// latência de ida pelo SFU, dezenas de milissegundos, abaixo da banda morta de
// DRIFT_IGNORE_MS. É mais simples que um ping/pong estilo NTP e resolve.
//
// A exceção é o retardatário, que lê o estado de um ATRIBUTO e não tem instante
// de chegada nenhum — ali o `atEpochMs` do outro é usado como está. Ele pode
// cair alguns segundos errado se os relógios discordarem, e o primeiro
// heartbeat (≤ HEARTBEAT_MS depois) o puxa pro lugar com um seek corretivo.

/** Abaixo disso, não mexe em nada. Ruído de medição do player mora aqui. */
export const DRIFT_IGNORE_MS = 250;

/** Acima disso, seek corretivo — ajustar velocidade demoraria demais. */
export const DRIFT_SEEK_MS = 1000;

/** Em quanto tempo a correção por velocidade fecha a diferença. */
export const RATE_CATCHUP_MS = 10_000;

/** Teto do ajuste de velocidade. 10% não dá pra perceber; 50% dá. */
export const MAX_RATE_NUDGE = 0.1;

/**
 * Quanto atrás da borda ao vivo o grupo senta. Na borda cada player está onde
 * o buffer DELE chegou, e isso varia por pessoa — não existe ponto de
 * encontro. 10s atrás todo mundo já tem aquilo em buffer.
 */
export const LIVE_BEHIND_MS = 10_000;

/** De quanto em quanto tempo o host reanuncia a posição. */
export const HEARTBEAT_MS = 3000;

/** De quanto em quanto tempo cada cliente confere o próprio drift. */
export const DRIFT_CHECK_MS = 1000;

/**
 * Chave do atributo de participante. Prefixada porque o mapa é global da sala,
 * e `watchSession` (não `watch`) porque `concord.watching` já existe e é outra
 * coisa — quem está assistindo qual transmissão de tela, em
 * lib/useScreenShareViewers.ts. Dois nomes onde um é prefixo do outro é
 * convite pra troca acidental num copy-paste.
 */
export const WATCH_ATTRIBUTE = 'concord.watchSession';

/** Tópico do data channel. */
export const WATCH_TOPIC = 'watch';

/**
 * A linha do tempo do grupo. `positionMs` é a posição da mídia no instante
 * `atEpochMs`; com `playing` e `rate` dá pra derivar a posição em qualquer
 * outro instante (ver `positionAt`).
 */
export interface WatchTimeline {
  /** Opaco pro protocolo: URL do YouTube (W4) ou do proxy do Jellyfin (W3). */
  src: string;
  playing: boolean;
  positionMs: number;
  atEpochMs: number;
  rate: number;
}

export type WatchMessageType = 'play' | 'pause' | 'seek' | 'rate' | 'hb' | 'stop';

/** O que trafega no data channel. JSON cru, igual à soundboard. */
export interface WatchMessage extends WatchTimeline {
  type: WatchMessageType;
  /** Nome limpo de quem mandou, só pra UI dizer "fulano pausou". */
  by: string;
}

export type WatchCorrection =
  | { action: 'none' }
  | { action: 'rate'; rate: number }
  | { action: 'seek'; positionMs: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Onde a mídia deveria estar, no relógio local, em `nowEpochMs`. */
export function positionAt(timeline: WatchTimeline, nowEpochMs: number): number {
  if (!timeline.playing) {
    return Math.max(0, timeline.positionMs);
  }
  const elapsed = (nowEpochMs - timeline.atEpochMs) * timeline.rate;
  return Math.max(0, timeline.positionMs + elapsed);
}

/**
 * Reancora uma mensagem no relógio de quem recebe. Ver o comentário do topo:
 * `receivedAtEpochMs` presente = veio ao vivo pelo data channel; ausente = veio
 * de um atributo, e aí não há instante de chegada pra usar.
 */
export function timelineFromMessage(
  message: WatchMessage | WatchTimeline,
  receivedAtEpochMs?: number,
): WatchTimeline {
  const timeline: WatchTimeline = {
    src: message.src,
    playing: message.playing,
    positionMs: message.positionMs,
    atEpochMs: message.atEpochMs,
    rate: message.rate,
  };
  if (receivedAtEpochMs === undefined) {
    return timeline;
  }
  return { ...timeline, atEpochMs: receivedAtEpochMs };
}

/**
 * Correção de drift em dois níveis, como o SyncPlay do Jellyfin: diferença
 * pequena vira ajuste de velocidade (imperceptível), diferença grande vira
 * seek.
 *
 * Dentro da banda morta devolve `rate: baseRate` em vez de `none` porque essa
 * É a instrução certa: quem estava corrigindo precisa voltar ao normal. Quem
 * chama só aplica quando o valor muda.
 *
 * @param targetMs onde o grupo está.
 * @param actualMs onde este player está.
 * @param baseRate a velocidade pedida pelo grupo (1 = normal).
 * @param playing se o grupo está tocando. Pausado, ajustar velocidade não
 *   corrige nada — só o seek resolve.
 */
export function correction(
  targetMs: number,
  actualMs: number,
  baseRate: number,
  playing: boolean,
): WatchCorrection {
  const delta = targetMs - actualMs; // > 0 = este player está atrasado
  const distance = Math.abs(delta);

  if (distance >= DRIFT_SEEK_MS) {
    return { action: 'seek', positionMs: targetMs };
  }
  if (!playing || distance < DRIFT_IGNORE_MS) {
    return { action: 'rate', rate: baseRate };
  }
  const nudge = clamp(delta / RATE_CATCHUP_MS, -MAX_RATE_NUDGE, MAX_RATE_NUDGE);
  return { action: 'rate', rate: baseRate * (1 + nudge) };
}

/**
 * Onde o grupo senta numa transmissão ao vivo, dado onde a borda está NESTE
 * player. Medido no navegador (2026-08-29, live manifestless com DVR): seek
 * pra trás funciona e é preciso — alvo 2 min atrás caiu a 0,64s dele. Perto da
 * borda erra mais (2,8s num alvo de 10s atrás), o que é exatamente o motivo de
 * não sentar NA borda.
 */
export function liveTargetMs(edgeMs: number): number {
  return Math.max(0, edgeMs - LIVE_BEHIND_MS);
}

/**
 * Quem manda o heartbeat. Função pura do conjunto de participantes na sessão,
 * então todo mundo chega na mesma resposta sem negociar nada — e quando quem
 * abriu a sessão fecha a aba, o próximo assume sozinho no tick seguinte. É o
 * "o bastão passa" que o Pedro pediu: fechar uma aba sem querer não derruba o
 * filme de ninguém.
 */
export function pickHost(identities: readonly string[]): string | null {
  let host: string | null = null;
  for (const identity of identities) {
    if (host === null || identity < host) {
      host = identity;
    }
  }
  return host;
}

/**
 * Se a mensagem que chegou não diz nada que já não saibamos. O heartbeat é
 * redundância por desenho (pacote perdido, retardatário), então na esmagadora
 * maioria das vezes ele repete o que já está valendo — e adotá-lo mesmo assim
 * substituiria o objeto da linha do tempo a cada 3s, o que reescreveria o
 * atributo de participante e re-renderizaria a árvore inteira de graça, por
 * pessoa. Comparar as duas projeções no MESMO instante é o que torna isso
 * seguro: uma diferença real (alguém perdeu um comando) passa.
 */
export function isRedundant(
  current: WatchTimeline,
  incoming: WatchTimeline,
  nowEpochMs: number,
): boolean {
  return (
    current.src === incoming.src &&
    current.playing === incoming.playing &&
    current.rate === incoming.rate &&
    Math.abs(positionAt(current, nowEpochMs) - positionAt(incoming, nowEpochMs)) < DRIFT_IGNORE_MS
  );
}

/** Descarta lixo do canal de dados sem deixar o handler explodir. */
export function parseWatchMessage(raw: string): WatchMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Partial<WatchMessage>;
  if (
    typeof candidate.type !== 'string' ||
    typeof candidate.src !== 'string' ||
    typeof candidate.playing !== 'boolean' ||
    typeof candidate.positionMs !== 'number' ||
    typeof candidate.atEpochMs !== 'number' ||
    typeof candidate.rate !== 'number' ||
    !Number.isFinite(candidate.positionMs) ||
    !Number.isFinite(candidate.atEpochMs) ||
    !Number.isFinite(candidate.rate)
  ) {
    return null;
  }
  return {
    type: candidate.type as WatchMessageType,
    src: candidate.src,
    playing: candidate.playing,
    positionMs: candidate.positionMs,
    atEpochMs: candidate.atEpochMs,
    rate: candidate.rate,
    by: typeof candidate.by === 'string' ? candidate.by : 'alguém',
  };
}
