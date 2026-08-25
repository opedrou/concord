// Hash de senha e leitura da sessão autenticada a partir de uma requisição.
// Só roda em rotas Node.js (usa node:crypto e o banco) — o middleware, que
// roda no runtime Edge, usa apenas lib/session.ts.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { getDb } from './db';
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, signSession, verifySession } from './session';

const SCRYPT_KEYLEN = 64;

/** Hash de senha com scrypt (node:crypto), salt aleatório de 16 bytes por usuário. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

/** Compara senha em texto plano com o hash armazenado, em tempo constante. */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, keyHex] = storedHash.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  const derivedKey = scryptSync(password, salt, storedKey.length);
  if (derivedKey.length !== storedKey.length) return false;
  return timingSafeEqual(derivedKey, storedKey);
}

export interface AuthUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

interface UserRow {
  id: number;
  username: string;
  is_admin: number;
  session_version: number;
}

/**
 * Resolve o usuário autenticado a partir do cookie de sessão da requisição.
 * Sempre relê username/is_admin do banco (o cookie só guarda id e versão) —
 * assim exclusão ou promoção/despromoção de admin valem na próxima
 * requisição, sem esperar a sessão expirar.
 *
 * É aqui, e só aqui, que a versão de sessão do token é conferida contra a do
 * banco: versão diferente = cookie revogado (senha trocada, ou "sair de todos
 * os dispositivos"), e a requisição vira não-autenticada. Ficando em
 * `getAuthUser`, vale de uma vez para `requireUser`, `requireAdmin` e
 * `/api/auth/me`. O middleware (Edge, sem banco) não faz essa checagem — ele
 * é só UX, como o comentário dele já diz.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (!session) return null;

  const db = getDb();
  const row = db
    .prepare('SELECT id, username, is_admin, session_version FROM users WHERE id = ?')
    .get(session.uid) as UserRow | undefined;
  if (!row) return null;
  if (row.session_version !== session.sessionVersion) return null;

  return { id: row.id, username: row.username, isAdmin: row.is_admin === 1 };
}

/**
 * Monta o header `Set-Cookie` de login. A versão de sessão vem por parâmetro:
 * quem chama já tem a linha do usuário em mãos (login) ou acabou de
 * incrementá-la (troca de senha), então reler do banco aqui seria só um
 * SELECT a mais.
 */
export async function buildSessionCookie(uid: number, sessionVersion: number): Promise<string> {
  const token = await signSession(uid, sessionVersion);
  return serializeCookie(SESSION_COOKIE_NAME, token, SESSION_TTL_SECONDS);
}

/** Monta o header `Set-Cookie` que derruba a sessão (logout). */
export function buildLogoutCookie(): string {
  return serializeCookie(SESSION_COOKIE_NAME, '', 0);
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const attrs = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.NODE_ENV === 'production') {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}
