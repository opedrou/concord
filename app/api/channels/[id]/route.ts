// PATCH /api/channels/:id   (admin)
//   Body: { name?: string, slug?: string, position?: number }  — todos opcionais,
//   manda só o que quer mudar. Renomear não muda o slug automaticamente
//   (evita quebrar quem já entrou na sala pelo slug antigo); pra trocar o
//   slug, mande `slug` explicitamente.
//   200: { id, name, slug, position }
//   400: { error: 'invalid_body' }
//   401/403: sem sessão / não-admin
//   404: { error: 'not_found' }
//   409: { error: 'slug_taken' }
//
// DELETE /api/channels/:id   (admin)
//   204 (sem corpo)
//   401/403 / 404: { error: 'not_found' }
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { DbChannel, getDb } from '@/lib/db';
import { slugify } from '@/lib/slug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toPublicChannel(row: DbChannel) {
  return { id: row.id, name: row.name, slug: row.slug, position: row.position };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
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
  const { name, slug: slugInput, position } = (body ?? {}) as {
    name?: unknown;
    slug?: unknown;
    position?: unknown;
  };

  const db = getDb();
  const existing = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as unknown as DbChannel | undefined;
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let newName = existing.name;
  let newSlug = existing.slug;
  let newPosition = existing.position;

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    newName = name.trim();
  }
  if (slugInput !== undefined) {
    if (typeof slugInput !== 'string' || !slugify(slugInput)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    newSlug = slugify(slugInput);
  }
  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    newPosition = position;
  }

  if (newSlug !== existing.slug) {
    const slugOwner = db.prepare('SELECT id FROM channels WHERE slug = ? AND id != ?').get(newSlug, id);
    if (slugOwner) {
      return NextResponse.json({ error: 'slug_taken' }, { status: 409 });
    }
  }

  db.prepare('UPDATE channels SET name = ?, slug = ?, position = ? WHERE id = ?').run(
    newName,
    newSlug,
    newPosition,
    id,
  );

  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as unknown as DbChannel;
  return NextResponse.json(toPublicChannel(row));
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const result = db.prepare('DELETE FROM channels WHERE id = ?').run(id);
  if (Number(result.changes) === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
