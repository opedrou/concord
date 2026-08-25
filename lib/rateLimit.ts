// Limitador de tentativas em memória, com janela deslizante. Hoje só o login
// usa (ver app/api/auth/login/route.ts): sem isso, dá pra tentar senha por
// força bruta à vontade.
//
// Guarda os timestamps das tentativas falhas por chave num `Map` em
// `globalThis` — mesmo modelo do lib/db.ts e do lib/messageBus.ts: a app roda
// como um único processo Node por container, sem réplicas atrás de um load
// balancer, e o `globalThis` sobrevive ao Fast Refresh do `next dev` (que
// re-executa o módulo e zeraria um `Map` de escopo de módulo). Se um dia isso
// escalar horizontalmente, o contador precisa virar algo compartilhado
// (Redis) — limitação conhecida.
//
// A limpeza é preguiçosa: cada acesso descarta os timestamps fora da janela e
// remove a chave quando ela fica vazia. Nada de `setInterval`, que segura o
// processo vivo à toa.

/** Tentativas falhas toleradas dentro da janela antes de bloquear. */
export const MAX_ATTEMPTS = 5;
/** Tamanho da janela deslizante, em milissegundos (15 min). */
export const WINDOW_MS = 15 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __rateLimitAttempts: Map<string, number[]> | undefined;
}

function getAttempts(): Map<string, number[]> {
  if (!globalThis.__rateLimitAttempts) {
    globalThis.__rateLimitAttempts = new Map();
  }
  return globalThis.__rateLimitAttempts;
}

/**
 * Timestamps ainda dentro da janela para a chave, já podados do `Map`.
 * Também aproveita a passada para expirar as outras chaves velhas, para o
 * `Map` não crescer para sempre.
 */
function liveAttempts(key: string, now: number): number[] {
  const store = getAttempts();
  const cutoff = now - WINDOW_MS;

  for (const [k, times] of store) {
    const live = times.filter((t) => t > cutoff);
    if (live.length === 0) store.delete(k);
    else store.set(k, live);
  }

  return store.get(key) ?? [];
}

/**
 * Quantos segundos faltam até a chave voltar a poder tentar, ou 0 se ela não
 * está bloqueada. Serve tanto de teste ("está bloqueado?") quanto de valor do
 * header `Retry-After`.
 */
export function retryAfterSeconds(key: string, now: number = Date.now()): number {
  const times = liveAttempts(key, now);
  if (times.length < MAX_ATTEMPTS) return 0;
  // A mais antiga da janela é a que precisa sair para abrir uma vaga.
  const freesAt = times[0] + WINDOW_MS;
  return Math.max(1, Math.ceil((freesAt - now) / 1000));
}

/** Registra uma tentativa falha para a chave. */
export function recordFailure(key: string, now: number = Date.now()): void {
  const times = liveAttempts(key, now);
  times.push(now);
  getAttempts().set(key, times);
}

/** Zera o contador da chave (chamar quando a tentativa dá certo). */
export function clearAttempts(key: string): void {
  getAttempts().delete(key);
}
