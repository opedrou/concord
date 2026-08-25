// GET /api/users   (admin)
//   200: Array<{ id, username, isAdmin, createdAt }>   — nunca inclui password_hash
//   401/403: sem sessão / não-admin
//
// POST /api/users   (admin)
//   Body: { username: string, password: string, isAdmin?: boolean }
//   201: { id, username, isAdmin, createdAt }
//   400: { error: 'invalid_body' }
//   400: { error: 'password_too_short', reason } — senha menor que o mínimo (lib/passwordPolicy.ts)
//   400: { error: 'password_too_weak', reason } — senha comum, sequência, ou contendo o username
//   401/403: sem sessão / não-admin
//   409: { error: 'username_taken' }
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { hashPassword } from '@/lib/auth';
import { DbUser, getDb } from '@/lib/db';
import { checkPassword } from '@/lib/passwordPolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toPublicUser(row: DbUser) {
  // Nunca devolver password_hash em resposta nenhuma.
  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  const rows = db.prepare('SELECT * FROM users ORDER BY username ASC').all() as unknown as DbUser[];
  return NextResponse.json(rows.map(toPublicUser));
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { username, password, isAdmin } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
    isAdmin?: unknown;
  };
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (isAdmin !== undefined && typeof isAdmin !== 'boolean') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  // Regra de senha em lib/passwordPolicy.ts — a mesma pro PATCH e pro
  // change-password. O client checa igual, mas quem decide é aqui.
  const problem = checkPassword(password, username);
  if (problem) {
    return NextResponse.json({ error: problem.code, reason: problem.reason }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    return NextResponse.json({ error: 'username_taken' }, { status: 409 });
  }

  const passwordHash = hashPassword(password);
  const createdAt = Date.now();
  const result = db
    .prepare(
      'INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(username.trim(), passwordHash, isAdmin ? 1 : 0, createdAt);

  const row = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as unknown as DbUser;
  return NextResponse.json(toPublicUser(row), { status: 201 });
}
