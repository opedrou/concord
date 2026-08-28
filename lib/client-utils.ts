export function encodePassphrase(passphrase: string) {
  return encodeURIComponent(passphrase);
}

export function decodePassphrase(base64String: string) {
  return decodeURIComponent(base64String);
}

export function generateRoomId(): string {
  return `${randomString(4)}-${randomString(4)}`;
}

export function randomString(length: number): string {
  let result = '';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function isLowPowerDevice() {
  return navigator.hardwareConcurrency < 6;
}

export function isMeetStaging() {
  return new URL(location.origin).host === 'meet.staging.livekit.io';
}

// --- Identity estavel por aba ------------------------------------------------
//
// Sufixo opaco da identity do LiveKit (ver app/api/connection-details/route.ts).
// Precisa ser ESTAVEL enquanto a aba viver, e nao aleatorio por conexao: o
// LiveKit derruba sozinho a sessao antiga quando alguem entra com a MESMA
// identity de um participante ja conectado. Com sufixo aleatorio esse kick
// nativo nunca dispara, e toda reconexao em que o `room.disconnect()` do
// cleanup nao roda (F5 duro, aba fechada na marra, queda de rede) deixa a
// sessao velha pendurada no SFU — a pessoa aparece 2x, 3x na grade e o
// fantasma so some quando alguem sai.
//
// `sessionStorage` e NAO `localStorage`, de proposito: localStorage e
// compartilhado entre as abas do mesmo site, entao abrir a segunda aba
// derrubaria a primeira. Cada aba tem o seu — a mesma conta em varias
// abas/dispositivos continua funcionando, que e o motivo do sufixo existir.
const TAB_SESSION_KEY = 'concord:tab-session-id';

// Mesma regra que o servidor aplica: so [a-zA-Z0-9-], curto e limitado. Sem
// `_`, entao e impossivel forjar o separador `__` da identity.
const TAB_SESSION_ID_RE = /^[a-zA-Z0-9-]{8,36}$/;

/**
 * Id opaco desta aba, criado na primeira chamada e reaproveitado em todas as
 * reconexoes seguintes. Devolve `null` se o navegador bloquear o
 * sessionStorage — nesse caso o servidor cai no sufixo aleatorio de antes e a
 * call entra do mesmo jeito.
 */
export function getTabSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.sessionStorage.getItem(TAB_SESSION_KEY);
    if (saved && TAB_SESSION_ID_RE.test(saved)) return saved;
    const fresh =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${randomString(8)}-${randomString(8)}-${randomString(8)}`;
    window.sessionStorage.setItem(TAB_SESSION_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}
