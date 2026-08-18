// POST /api/channels/reorder   (admin)
//   Body: { order: number[] }   — lista de ids de canal na ordem desejada.
//   Precisa conter exatamente os ids de todos os canais existentes (senão
//   400) — evita reordenar parcial e deixar `position` inconsistente.
//   200: Array<{ id, name, slug, position }>   já na nova ordem
//   400: { error: 'invalid_body' }
//   401/403: sem sessão / não-admin
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { DbChannel, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toPublicChannel(row: DbChannel) {
  return { id: row.id, name: row.name, slug: row.slug, position: row.position };
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
  const { order } = (body ?? {}) as { order?: unknown };
  if (!Array.isArray(order) || order.some((v) => typeof v !== 'number')) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const db = getDb();
  const existingIds = (db.prepare('SELECT id FROM channels').all() as { id: number }[])
    .map((r) => r.id)
    .sort((a, b) => a - b);
  const orderIds = [...(order as number[])].sort((a, b) => a - b);

  if (
    existingIds.length !== orderIds.length ||
    existingIds.some((id, i) => id !== orderIds[i])
  ) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const update = db.prepare('UPDATE channels SET position = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    (order as number[]).forEach((id, index) => update.run(index, id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const rows = db.prepare('SELECT * FROM channels ORDER BY position ASC, id ASC').all() as unknown as DbChannel[];
  return NextResponse.json(rows.map(toPublicChannel));
}
