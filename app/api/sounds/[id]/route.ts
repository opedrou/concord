// GET    /api/sounds/:id — os bytes do som
// PATCH  /api/sounds/:id — renomeia (name) e/ou ajusta o corte (trimStart/trimEnd)
// DELETE /api/sounds/:id — remove da biblioteca
//
//   Apagar e editar: só quem subiu ou um admin. Mesma regra (e mesmo formato de código)
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
import { MAX_SOUND_NAME_LENGTH, SOUNDS_DIR, resolveSoundPath, toPublicSound } from '@/lib/sounds';
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

/**
 * Edita o que é editável num som: o NOME (o rótulo do botão) e o CORTE.
 *
 * Parcial de propósito — campo ausente fica como está. O corte não toca no
 * arquivo: grava dois números que o cliente aplica na hora de tocar (ver a
 * migração em lib/db.ts e o `playSfx`); `trimEnd: null` volta a tocar até o
 * fim. O nome é só rótulo: o arquivo no disco continua com o nome UUID que
 * ele já tinha, então renomear não invalida cache nem URL.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  let body: { name?: unknown; trimStart?: unknown; trimEnd?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  let name = sound.name;
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    // Rótulo de botão: uma linha, sem espaço sobrando, curto. Nome vazio é
    // recusado em vez de virar "som" — quem renomeou quis dizer alguma coisa.
    name = body.name.replace(/\s+/g, ' ').trim().slice(0, MAX_SOUND_NAME_LENGTH);
    if (!name) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
  }

  const trimStart = body.trimStart === undefined ? sound.trim_start : Number(body.trimStart);
  const trimEnd =
    body.trimEnd === undefined
      ? sound.trim_end
      : body.trimEnd === null
        ? null
        : Number(body.trimEnd);
  // A duração real do áudio só é conhecida no cliente (quem decodifica), então
  // aqui a validação é a que dá pra fazer sem decodificar: números finitos,
  // não negativos e em ordem.
  const valid =
    Number.isFinite(trimStart) &&
    trimStart >= 0 &&
    (trimEnd === null || (Number.isFinite(trimEnd) && trimEnd > trimStart));
  if (!valid) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  getDb()
    .prepare('UPDATE sounds SET name = ?, trim_start = ?, trim_end = ? WHERE id = ?')
    .run(name, trimStart, trimEnd, id);

  return NextResponse.json(
    toPublicSound({ ...sound, name, trim_start: trimStart, trim_end: trimEnd }),
  );
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
