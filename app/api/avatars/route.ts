// POST /api/avatars   (qualquer usuário logado — só a própria foto)
//   Multipart/form-data com um campo "avatar" contendo a imagem. Sempre
//   troca a foto do usuário da sessão — não existe parâmetro pra mirar em
//   outro id, então não tem como um usuário trocar a foto de outro por essa
//   rota (o caso de admin trocar foto de qualquer um ficou fora de escopo).
//
//   200: { avatarUrl: string }
//   400: { error: 'invalid_body' } — sem campo "avatar" ou não é um arquivo
//   400: { error: 'invalid_format' } — magic bytes não batem com jpeg/png/webp/gif
//   401: { error: 'not_authenticated' }
//   413: { error: 'file_too_large' } — Content-Length ou corpo real acima do limite
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import {
  MAX_AVATAR_BYTES,
  deleteAvatarFileIfExists,
  detectImageFormat,
  saveAvatarFile,
} from '@/lib/avatars';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  // Primeira linha de defesa: Content-Length mentiroso só consegue
  // sub-declarar (inofensivo) — mas já corta de cara o caso comum de
  // arquivo grande demais sem tocar no corpo.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  if (!request.body) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Segunda linha de defesa, a que realmente importa: lê o corpo em stream e
  // aborta assim que passar do limite, em vez de bufferizar tudo (via
  // request.formData()) pra só então checar o tamanho. Um Content-Length
  // forjado (ou chunked sem header) não escapa dessa.
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_AVATAR_BYTES) {
      await reader.cancel().catch(() => {});
      return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    }
    chunks.push(value);
  }
  const rawBody = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Reconstrói o multipart a partir do buffer já com tamanho garantido, e
  // deixa a Web API `Response.formData()` fazer o parsing de verdade — não
  // reinventamos parser de multipart aqui.
  const contentType = request.headers.get('content-type') ?? '';
  let formData: FormData;
  try {
    formData = await new Response(rawBody, { headers: { 'content-type': contentType } }).formData();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const file = formData.get('avatar');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (fileBytes.length === 0 || fileBytes.length > MAX_AVATAR_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
  }

  // Nunca confiamos em file.type (vem do navegador, controlado por quem
  // envia) nem em file.name — só o conteúdo real decide o formato.
  const format = detectImageFormat(fileBytes);
  if (!format) {
    return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(user.id) as
    | { avatar_path: string | null }
    | undefined;
  const previousAvatar = row?.avatar_path ?? null;

  const filename = saveAvatarFile(fileBytes, format.ext);
  db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(filename, user.id);

  // Só remove o arquivo antigo depois que o novo já está salvo e o banco já
  // aponta pra ele — evita ficar sem avatar nenhum se algo falhar no meio.
  deleteAvatarFileIfExists(previousAvatar);

  return NextResponse.json({ avatarUrl: `/api/avatars/${user.id}` });
}
