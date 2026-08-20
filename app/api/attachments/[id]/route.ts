// GET /api/attachments/:messageId
//   Serve o anexo de uma mensagem. Autenticado como tudo o mais — `/api` está
//   FORA do middleware, então o guard aqui não é redundante, é a única barreira.
//
//   200: os bytes
//   401: { error: 'not_authenticated' }
//   404: { error: 'not_found' } — mensagem sem anexo, ou arquivo sumiu do disco
import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import { resolveAttachmentPath } from '@/lib/attachments';
import { dispositionFor, formatFromExt } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const row = getDb()
    .prepare(
      'SELECT attachment_path, attachment_name FROM messages WHERE id = ? AND attachment_path IS NOT NULL',
    )
    .get(id) as { attachment_path: string; attachment_name: string | null } | undefined;
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(resolveAttachmentPath(row.attachment_path));
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Content-type derivado da extensão que NÓS gravamos (que veio dos magic
  // bytes), nunca de header do cliente. Tipo desconhecido vai como download
  // forçado — é o que impede um arquivo qualquer de ser interpretado como
  // documento ativo na nossa origem.
  const ext = row.attachment_path.split('.').pop() ?? '';
  const format = formatFromExt(ext);
  const filename = (row.attachment_name ?? `arquivo.${format.ext}`).replace(/"/g, '');

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': format.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${dispositionFor(format.kind)}; filename="${filename}"`,
      // O nome do arquivo é um UUID: a URL nunca muda de conteúdo, então dá
      // pra cachear pra sempre. Mesmo raciocínio do avatar versionado.
      'Cache-Control': request.nextUrl.searchParams.has('v')
        ? 'private, max-age=31536000, immutable'
        : 'private, max-age=300',
    },
  });
}
