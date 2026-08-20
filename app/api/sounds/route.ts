// GET  /api/sounds            — lista a biblioteca compartilhada
// POST /api/sounds?name=<nome> — sobe um som (qualquer usuário logado)
//
//   A biblioteca é do GRUPO, não de cada pessoa: quem sobe disponibiliza pra
//   todo mundo tocar. Ver lib/sounds.ts.
//
//   200/201: Sound | Sound[]
//   400: { error: 'invalid_body' } | { error: 'unsupported_format' }
//   401: { error: 'not_authenticated' }
//   413: { error: 'file_too_large' }
import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { getDb, type DbSound } from '@/lib/db';
import {
  MAX_SOUND_BYTES,
  MAX_SOUND_NAME_LENGTH,
  SOUNDS_DIR,
  isAcceptedSoundFormat,
  resolveSoundPath,
  toPublicSound,
} from '@/lib/sounds';
import {
  EmptyUploadError,
  UploadTooLargeError,
  sanitizeDisplayName,
  saveUploadStream,
} from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const rows = getDb()
    .prepare('SELECT * FROM sounds ORDER BY name COLLATE NOCASE ASC')
    .all() as unknown as DbSound[];
  return NextResponse.json(rows.map(toPublicSound));
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOUND_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  let saved;
  try {
    saved = await saveUploadStream(request.body, SOUNDS_DIR, MAX_SOUND_BYTES);
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }
    if (error instanceof EmptyUploadError) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    console.error('[sounds] falha ao gravar upload:', error);
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  // Só áudio numa soundboard. Formato detectado pelos magic bytes, então
  // renomear um .mp4 pra .mp3 não engana — e o arquivo recusado sai do disco.
  if (!isAcceptedSoundFormat(saved.format)) {
    try {
      fs.unlinkSync(resolveSoundPath(saved.filename));
    } catch {
      // Best-effort.
    }
    return NextResponse.json({ error: 'unsupported_format' }, { status: 400 });
  }

  const rawName = sanitizeDisplayName(request.nextUrl.searchParams.get('name'), saved.format.ext);
  // Nome de botão, não nome de arquivo: tira a extensão e corta curto.
  const name = rawName.replace(/\.[^.]+$/, '').slice(0, MAX_SOUND_NAME_LENGTH) || 'som';

  const createdAt = Date.now();
  const result = getDb()
    .prepare(
      'INSERT INTO sounds (name, filename, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(name, saved.filename, saved.format.contentType, saved.size, user.id, createdAt);

  return NextResponse.json(
    toPublicSound({
      id: Number(result.lastInsertRowid),
      name,
      filename: saved.filename,
      mime: saved.format.contentType,
      size: saved.size,
      uploaded_by: user.id,
      created_at: createdAt,
      trim_start: 0,
      trim_end: null,
    }),
    { status: 201 },
  );
}
