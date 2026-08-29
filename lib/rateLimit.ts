// Limitador de tentativas em memória, com janela deslizante. Dois usos hoje,
// com números bem diferentes:
//   - login (app/api/auth/login/route.ts): 5 FALHAS em 15 min, chave por
//     `<ip>|<username>` — freia força bruta de senha;
//   - chamar pessoas (app/api/call-people/route.ts): 6 SUCESSOS em 1 h, chave
//     por `call:<userId>` — freia spam de notificação.
//
// Guarda os timestamps das tentativas por chave num `Map` em `globalThis` —
// mesmo modelo do lib/db.ts e do lib/messageBus.ts: a app roda como um único
// processo Node por container, sem réplicas atrás de um load balancer, e o
// `globalThis` sobrevive ao Fast Refresh do `next dev` (que re-executa o
// módulo e zeraria um `Map` de escopo de módulo). Se um dia isso escalar
// horizontalmente, o contador precisa virar algo compartilhado (Redis) —
// limitação conhecida.
//
// A limpeza é preguiçosa: cada acesso descarta os timestamps fora da janela e
// remove a chave quando ela fica vazia. Nada de `setInterval`, que segura o
// processo vivo à toa.
//
// ─── Por que cada chave guarda a PRÓPRIA janela ────────────────────────────
//
// A poda preguiçosa passa por todas as chaves do `Map`, não só pela que está
// sendo consultada. Enquanto existia uma janela única (15 min) isso era
// inofensivo. Com duas janelas convivendo, podar tudo com a janela do chamador
// da vez fica errado justamente para a outra: um `retryAfterSeconds` do login
// (15 min) varrendo o `Map` apagaria as marcas de "chamar" com 20 minutos de
// idade, que ainda deveriam contar por mais 40 — e o limite de 6/h viraria
// 6-por-15-min-desde-o-último-login. Namespace na chave (`call:` / o par
// ip|username do login) evita colisão de identidade, mas não conserta a poda,
// porque a poda não olha o nome da chave.
//
// A correção mais simples que fica certa: cada entrada guarda o `windowMs` com
// que foi gravada, e a poda usa o da própria entrada. Nenhuma varredura precisa
// saber quem é o chamador, e acrescentar um terceiro limite no futuro não
// reabre o problema.

/** Tentativas toleradas dentro da janela antes de bloquear. Default = login. */
export const MAX_ATTEMPTS = 5;
/** Tamanho da janela deslizante, em milissegundos (15 min). Default = login. */
export const WINDOW_MS = 15 * 60 * 1000;

/** Quantas tentativas cabem em quanto tempo. Um por caso de uso. */
export interface RateLimit {
  maxAttempts: number;
  windowMs: number;
}

/** Os números do login, que eram as constantes de módulo antes de C3. */
export const LOGIN_LIMIT: RateLimit = { maxAttempts: MAX_ATTEMPTS, windowMs: WINDOW_MS };

/** Timestamps de uma chave + a janela com que foram gravados (ver bloco acima). */
interface Bucket {
  windowMs: number;
  times: number[];
}

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitBuckets: Map<string, Bucket> | undefined;
}

function getBuckets(): Map<string, Bucket> {
  if (!globalThis.__rateLimitBuckets) {
    globalThis.__rateLimitBuckets = new Map();
  }
  return globalThis.__rateLimitBuckets;
}

/**
 * Timestamps ainda dentro da janela para a chave, já podados do `Map`.
 * Também aproveita a passada para expirar as outras chaves velhas — cada uma
 * pela SUA janela — para o `Map` não crescer para sempre.
 */
function liveAttempts(key: string, now: number): number[] {
  const store = getBuckets();

  for (const [k, bucket] of store) {
    const live = bucket.times.filter((t) => t > now - bucket.windowMs);
    if (live.length === 0) store.delete(k);
    else bucket.times = live;
  }

  return store.get(key)?.times ?? [];
}

/**
 * Quantos segundos faltam até a chave voltar a poder tentar, ou 0 se ela não
 * está bloqueada. Serve tanto de teste ("está bloqueado?") quanto de valor do
 * header `Retry-After`.
 */
export function retryAfterSeconds(
  key: string,
  now: number = Date.now(),
  limit: RateLimit = LOGIN_LIMIT,
): number {
  const times = liveAttempts(key, now);
  if (times.length < limit.maxAttempts) return 0;
  // A mais antiga da janela é a que precisa sair para abrir uma vaga.
  const freesAt = times[0] + limit.windowMs;
  return Math.max(1, Math.ceil((freesAt - now) / 1000));
}

/**
 * Registra uma tentativa para a chave. No login é uma FALHA de senha; em
 * /api/call-people é um SUCESSO (o que se quer limitar lá é quantas
 * notificações uma pessoa dispara, não quantas erra).
 */
export function recordFailure(
  key: string,
  now: number = Date.now(),
  limit: RateLimit = LOGIN_LIMIT,
): void {
  const times = liveAttempts(key, now);
  times.push(now);
  // Regrava a janela junto: é ela que a poda vai usar nas próximas passadas.
  getBuckets().set(key, { windowMs: limit.windowMs, times });
}

/** Zera o contador da chave (chamar quando a tentativa dá certo). */
export function clearAttempts(key: string): void {
  getBuckets().delete(key);
}
