// GET    /api/sounds/:id — os bytes do som
// DELETE /api/sounds/:id — remove da biblioteca
//
//   Apagar: só quem subiu ou um admin. Mesma regra (e mesmo formato de código)
//   de apagar mensagem em app/api/channels/[id]/messages/[messageId].
//
//   200: bytes | 204 (delete)
//   401: { error: 'not_authenticated' }
//   403: { error: 'forbidden' }
//   404: { error: 'not_found' }
import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { getDb, type DbSound } from '@/lib/db';
import { SOUNDS_DIR, resolveSoundPath } from '@/lib/sounds';
import { deleteUploadIfExists } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function loadSound(id: number): DbSound | undefined {
  return getDb().prepare('SELECT * FROM sounds WHERE id = ?').get(id) as unknown as
    | DbSound
    | undefined;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  const sound = id === null ? undefined : loadSound(id);
  if (!sound) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(resolveSoundPath(sound.filename));
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': sound.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      // O nome no disco é um UUID: a URL nunca muda de conteúdo. Cachear
      // agressivamente importa aqui mais que nos anexos — o mesmo som é
      // buscado por todo mundo a cada toque.
      'Cache-Control': request.nextUrl.searchParams.has('v')
        ? 'private, max-age=31536000, immutable'
        : 'private, max-age=300',
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  const sound = id === null ? undefined : loadSound(id);
  if (!sound || id === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isUploader = sound.uploaded_by !== null && sound.uploaded_by === user.id;
  if (!isUploader && !user.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  getDb().prepare('DELETE FROM sounds WHERE id = ?').run(id);
  deleteUploadIfExists(SOUNDS_DIR, sound.filename);

  return new NextResponse(null, { status: 204 });
}
