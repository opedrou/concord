// POST /api/auth/login
// Body: { username: string, password: string }
// 200: { username: string, isAdmin: boolean }              + Set-Cookie: session
// 400: { error: 'invalid_body' }                              — campos faltando
// 401: { error: 'invalid_credentials' }                        — usuário ou senha errados
//
// Não revela se o usuário existe ou não: mesma mensagem/status pros dois casos.
import { NextRequest, NextResponse } from 'next/server';
import { buildSessionCookie, verifyPassword } from '@/lib/auth';
import { DbUser, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | DbUser
    | undefined;

  // Mensagem/status idênticos pra usuário inexistente e senha errada — não
  // dá pra usar isso pra enumerar contas.
  if (!row || !verifyPassword(password, row.password_hash)) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  const cookie = await buildSessionCookie(row.id);
  return NextResponse.json(
    { username: row.username, isAdmin: row.is_admin === 1 },
    { status: 200, headers: { 'Set-Cookie': cookie } },
  );
}
