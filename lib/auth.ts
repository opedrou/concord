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
}

/**
 * Resolve o usuário autenticado a partir do cookie de sessão da requisição.
 * Sempre relê username/is_admin do banco (o cookie só guarda o id) — assim
 * exclusão, troca de senha ou promoção/despromoção de admin valem na próxima
 * requisição, sem esperar a sessão expirar.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const uid = await verifySession(token);
  if (uid === null) return null;

  const db = getDb();
  const row = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(uid) as
    | UserRow
    | undefined;
  if (!row) return null;

  return { id: row.id, username: row.username, isAdmin: row.is_admin === 1 };
}

/** Monta o header `Set-Cookie` de login. */
export async function buildSessionCookie(uid: number): Promise<string> {
  const token = await signSession(uid);
  return serializeCookie(SESSION_COOKIE_NAME, token, SESSION_TTL_SECONDS);
}

/** Monta o header `Set-Cookie` que derruba a sessão (logout). */
export function buildLogoutCookie(): string {
  return serializeCookie(SESSION_COOKIE_NAME, '', 0);
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const attrs = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === 'production') {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}
