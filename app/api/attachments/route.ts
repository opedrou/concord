// POST /api/attachments?name=<nome original>
//   Sobe UM arquivo pro chat. O corpo é o arquivo BRUTO (não multipart) —
//   ver a explicação em lib/uploads.ts: com 95 MiB, bufferizar multipart em
//   memória derrubaria o processo (e a chamada de voz de todo mundo junto).
//
//   Fluxo em duas etapas de propósito: sobe o arquivo, recebe um identificador,
//   e só então manda a mensagem referenciando ele. Assim um retry de upload de
//   90 MB não reenvia a mensagem, e a mensagem nunca existe apontando pra um
//   arquivo que não chegou.
//
//   200: { path, name, mime, kind, size }
//   400: { error: 'invalid_body' }   — corpo vazio
//   401: { error: 'not_authenticated' }
//   413: { error: 'file_too_large' }
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import {
  EmptyUploadError,
  UploadTooLargeError,
  sanitizeDisplayName,
  saveUploadStream,
} from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  // Primeira linha de defesa: Content-Length mentiroso só consegue
  // sub-declarar (inofensivo), mas já corta de cara o caso comum de arquivo
  // grande demais sem tocar no corpo. A defesa que realmente vale é o limite
  // aplicado durante o stream, dentro de saveUploadStream.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  if (!request.body) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const saved = await saveUploadStream(request.body, ATTACHMENTS_DIR, MAX_ATTACHMENT_BYTES);
    return NextResponse.json({
      // `path` é o nome no disco (UUID + extensão derivada dos magic bytes).
      // É o que o POST da mensagem devolve pra gente; o cliente não escolhe.
      path: saved.filename,
      name: sanitizeDisplayName(request.nextUrl.searchParams.get('name'), saved.format.ext),
      mime: saved.format.contentType,
      kind: saved.format.kind,
      size: saved.size,
    });
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }
    if (error instanceof EmptyUploadError) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    console.error('[attachments] falha ao gravar upload:', error);
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }
}
