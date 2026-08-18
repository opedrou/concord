// GET /api/channels
//   Lista todos os canais (voz e texto), ordenados por `position`. Qualquer
//   usuário logado.
//   200: Array<{ id: number, name: string, slug: string, position: number, type: 'voice' | 'text' }>
//   401: { error: 'not_authenticated' }
//
// POST /api/channels   (admin)
//   Body: { name: string, slug?: string, type?: 'voice' | 'text' }  — slug é
//   opcional, gerado a partir do nome quando ausente. `type` é opcional,
//   default 'voice' (retrocompatível com quem já chamava essa rota antes de
//   canais de texto existirem).
//   201: { id, name, slug, position, type }
//   400: { error: 'invalid_body' }
//   401/403: sem sessão / não-admin
//   409: { error: 'slug_taken' }   — slug já usado por outro canal
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/api-auth';
import { ChannelType, DbChannel, getDb } from '@/lib/db';
import { slugify } from '@/lib/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toPublicChannel(row: DbChannel) {
  return { id: row.id, name: row.name, slug: row.slug, position: row.position, type: row.type };
}

function parseChannelType(value: unknown): ChannelType | null {
  if (value === undefined) return 'voice';
  return value === 'voice' || value === 'text' ? value : null;
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
  const { name, slug: slugInput, type: typeInput } = (body ?? {}) as {
    name?: unknown;
    slug?: unknown;
    type?: unknown;
  };
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const type = parseChannelType(typeInput);
  if (type === null) {
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
    .prepare('INSERT INTO channels (name, slug, position, created_at, type) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), slug, position, Date.now(), type);

  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as DbChannel;
  return NextResponse.json(toPublicChannel(row), { status: 201 });
}
