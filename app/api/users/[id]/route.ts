// PATCH /api/users/:id   (admin)
//   Body: { password?: string, isAdmin?: boolean }   — reseta senha e/ou
//   promove/despromove admin. Pelo menos um dos dois deve ser enviado.
//   Resetar a senha incrementa users.session_version (S5): as sessões abertas
//   daquela conta caem na hora, em todos os dispositivos. É o ponto do reset
//   feito pelo admin — conta comprometida perde o acesso junto com a senha.
//   Bloqueia despromover o último admin restante (senão ninguém mais
//   administra o sistema).
//   200: { id, username, isAdmin, createdAt }
//   400: { error: 'invalid_body' } | { error: 'last_admin' }
//   400: { error: 'password_too_short', reason } — senha menor que o mínimo (lib/passwordPolicy.ts)
//   400: { error: 'password_too_weak', reason } — senha comum, sequência, ou contendo o username
//   401/403: sem sessão / não-admin
//   404: { error: 'not_found' }
//
// DELETE /api/users/:id   (admin)
//   Bloqueia apagar o último admin restante.
//   204 (sem corpo)
//   400: { error: 'last_admin' }
//   401/403 / 404: { error: 'not_found' }
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { hashPassword } from '@/lib/auth';
import { DbUser, getDb } from '@/lib/db';
import { checkPassword } from '@/lib/passwordPolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toPublicUser(row: DbUser) {
  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function countAdmins(db: ReturnType<typeof getDb>): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get() as {
    n: number;
  };
  return row.n;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { password, isAdmin } = (body ?? {}) as { password?: unknown; isAdmin?: unknown };
  if (password === undefined && isAdmin === undefined) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (password !== undefined && typeof password !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (isAdmin !== undefined && typeof isAdmin !== 'boolean') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as
    | DbUser
    | undefined;
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Depois de achar o usuário — a regra precisa do username pra recusar senha
  // que contenha o nome da conta. Mesma função do POST /api/users.
  if (password !== undefined) {
    const problem = checkPassword(password, existing.username);
    if (problem) {
      return NextResponse.json({ error: problem.code, reason: problem.reason }, { status: 400 });
    }
  }

  if (isAdmin === false && existing.is_admin === 1 && countAdmins(db) <= 1) {
    return NextResponse.json({ error: 'last_admin' }, { status: 400 });
  }

  if (password !== undefined) {
    db.prepare(
      'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?',
    ).run(hashPassword(password), id);
  }
  if (isAdmin !== undefined) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as DbUser;
  return NextResponse.json(toPublicUser(row));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as
    | DbUser
    | undefined;
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (existing.is_admin === 1 && countAdmins(db) <= 1) {
    return NextResponse.json({ error: 'last_admin' }, { status: 400 });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return new NextResponse(null, { status: 204 });
}
