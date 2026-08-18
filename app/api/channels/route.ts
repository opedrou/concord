// GET /api/channels
//   Lista todos os canais, ordenados por `position`. Qualquer usuário logado.
//   200: Array<{ id: number, name: string, slug: string, position: number }>
//   401: { error: 'not_authenticated' }
//
// POST /api/channels   (admin)
//   Body: { name: string, slug?: string }  — slug é opcional, gerado a partir
//   do nome quando ausente.
//   201: { id, name, slug, position }
//   400: { error: 'invalid_body' }
//   401/403: sem sessão / não-admin
//   409: { error: 'slug_taken' }   — slug já usado por outro canal
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/api-auth';
import { DbChannel, getDb } from '@/lib/db';
import { slugify } from '@/lib/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toPublicChannel(row: DbChannel) {
  return { id: row.id, name: row.name, slug: row.slug, position: row.position };
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  const rows = db.prepare('SELECT * FROM channels ORDER BY position ASC, id ASC').all() as unknown as DbChannel[];
  return NextResponse.json(rows.map(toPublicChannel));
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
  const { name, slug: slugInput } = (body ?? {}) as { name?: unknown; slug?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const slug = slugify(typeof slugInput === 'string' && slugInput ? slugInput : name);
  if (!slug) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM channels WHERE slug = ?').get(slug);
  if (existing) {
    return NextResponse.json({ error: 'slug_taken' }, { status: 409 });
  }

  const maxPosition = db.prepare('SELECT COALESCE(MAX(position), -1) AS maxPos FROM channels').get() as {
    maxPos: number;
  };
  const position = maxPosition.maxPos + 1;

  const result = db
    .prepare('INSERT INTO channels (name, slug, position, created_at) VALUES (?, ?, ?, ?)')
    .run(name.trim(), slug, position, Date.now());

  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as DbChannel;
  return NextResponse.json(toPublicChannel(row), { status: 201 });
}
