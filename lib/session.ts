// Assinatura/verificação do cookie de sessão usando a Web Crypto API
// (`crypto.subtle`), disponível tanto no runtime Node quanto no runtime Edge
// (usado pelo middleware). Por isso este arquivo não importa nada de
// `node:crypto` nem de outros módulos exclusivos do Node — mantém o mesmo
// código utilizável nos dois lugares, sem depender de nenhuma lib nova.
//
// Formato do token: "<payload-base64url>.<assinatura-base64url>"
// Payload: { uid: number, exp: number (epoch em segundos) }
//
// O payload carrega só o id do usuário. Username e is_admin são sempre
// relidos do banco a cada requisição (ver lib/auth.ts) para que uma troca de
// senha, promoção/despromoção ou exclusão de conta tenham efeito imediato,
// em vez de esperar a sessão expirar.

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

interface SessionPayload {
  uid: number;
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '=',
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Retorna o segredo usado para assinar sessões. Em produção, a ausência de
 * `SESSION_SECRET` é um erro fatal — nunca caímos para um valor default
 * inseguro fora do ambiente de desenvolvimento local.
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length > 0) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET não está definido. Configure essa variável de ambiente antes de subir em produção — sem ela não há como assinar sessões com segurança.',
    );
  }
  return 'dev-only-insecure-secret-nao-use-em-producao';
}

export async function signSession(uid: number): Promise<string> {
  const payload: SessionPayload = {
    uid,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey(getSessionSecret());
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = base64UrlEncode(new Uint8Array(signatureBytes));
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifica a assinatura e a validade do token de sessão.
 * Retorna o `uid` codificado no token, ou `null` se o token for inválido,
 * estiver com assinatura incorreta, ou tiver expirado.
 */
export async function verifySession(token: string | undefined | null): Promise<number | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  try {
    const key = await getHmacKey(getSessionSecret());
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(sigB64) as BufferSource,
      new TextEncoder().encode(payloadB64),
    );
    if (!isValid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    ) as SessionPayload;
    if (typeof payload.uid !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.uid;
  } catch {
    // Token malformado (base64 inválido, JSON quebrado, etc.)
    return null;
  }
}
