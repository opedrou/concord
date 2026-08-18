// DELETE /api/channels/:id/messages/:messageId
//   Apaga uma mensagem. Só o próprio autor ou um admin pode apagar —
//   checado no servidor (nunca confia em botão escondido na UI).
//   204 (sem corpo)
//   401: { error: 'not_authenticated' }
//   403: { error: 'forbidden' }   — logado, mas não é o autor nem admin
//   404: { error: 'not_found' }   — canal ou mensagem inexistente
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { DbMessage, getDb } from '@/lib/db';
import { publishChannelEvent } from '@/lib/messageBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  const { id: idParam, messageId: messageIdParam } = await params;
  const channelId = parseId(idParam);
  const messageId = parseId(messageIdParam);
  if (channelId === null || messageId === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const db = getDb();
  const message = db
    .prepare('SELECT * FROM messages WHERE id = ? AND channel_id = ?')
    .get(messageId, channelId) as unknown as DbMessage | undefined;
  if (!message) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAuthor = message.user_id !== null && message.user_id === user.id;
  if (!isAuthor && !user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);

  publishChannelEvent(channelId, { type: 'deleted', messageId, channelId });

  return new NextResponse(null, { status: 204 });
}
