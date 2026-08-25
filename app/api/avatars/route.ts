// POST /api/avatars   (qualquer usuário logado — só a própria foto)
//   Multipart/form-data com um campo "avatar" contendo a imagem. Sempre
//   troca a foto do usuário da sessão — não existe parâmetro pra mirar em
//   outro id, então não tem como um usuário trocar a foto de outro por essa
//   rota (o caso de admin trocar foto de qualquer um ficou fora de escopo).
//
//   Campo opcional "color": a cor dominante da foto, `#rrggbb`, calculada no
//   cliente junto do redimensionamento (ver lib/dominantColor.ts). Vem do
//   navegador, entao e VALIDADA aqui (normalizeAvatarColor) — o que nao for
//   `#rrggbb` vira null, e o tile cai no `--accent`.
//
//   200: { avatarUrl: string, avatarColor: string | null }
//   400: { error: 'invalid_body' } — sem campo "avatar" ou não é um arquivo
//   400: { error: 'invalid_format' } — magic bytes não batem com jpeg/png/webp/gif
//   401: { error: 'not_authenticated' }
//   413: { error: 'file_too_large' } — Content-Length ou corpo real acima do limite
//
// PATCH /api/avatars   (qualquer usuário logado — só a própria cor)
//   BACKFILL da cor dominante das fotos que já existiam antes da coluna
//   `users.avatar_color`. Quem calcula é o cliente (o servidor não decodifica
//   imagem), então só ele pode preencher — ver lib/useCurrentUser.ts. Sempre
//   age sobre o usuário da sessão, e só grava quando a coluna está VAZIA:
//   trocar a cor da própria foto à toa não é caso de uso, e não gravar por
//   cima fecha a porta pra alguém pintar o próprio tile do que quiser.
//
//   200: { avatarColor: string | null } — null quando não havia o que preencher
//   400: { error: 'invalid_body' } — JSON inválido ou cor fora de `#rrggbb`
//   401: { error: 'not_authenticated' }
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import {
  MAX_AVATAR_BYTES,
  avatarUrlFor,
  deleteAvatarFileIfExists,
  detectImageFormat,
  normalizeAvatarColor,
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

  // Cor dominante calculada pelo cliente. Nunca confiamos no valor cru: o que
  // nao for `#rrggbb` vira null e a foto simplesmente fica sem cor (o tile usa
  // o `--accent`) — foto nova nao pode falhar por causa disso.
  const avatarColor = normalizeAvatarColor(formData.get('color'));

  const db = getDb();
  const row = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(user.id) as
    | { avatar_path: string | null }
    | undefined;
  const previousAvatar = row?.avatar_path ?? null;

  const filename = saveAvatarFile(fileBytes, format.ext);
  db.prepare('UPDATE users SET avatar_path = ?, avatar_color = ? WHERE id = ?').run(
    filename,
    avatarColor,
    user.id,
  );

  // Só remove o arquivo antigo depois que o novo já está salvo e o banco já
  // aponta pra ele — evita ficar sem avatar nenhum se algo falhar no meio.
  deleteAvatarFileIfExists(previousAvatar);

  // Versionada com o nome do arquivo novo — é o que faz a foto trocada
  // aparecer sem F5 pra quem acabou de fazer o upload (ver avatarUrlFor).
  return NextResponse.json({ avatarUrl: avatarUrlFor(user.id, filename), avatarColor });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const color = normalizeAvatarColor((body as { color?: unknown } | null)?.color);
  if (!color) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const db = getDb();
  // `avatar_color IS NULL` no WHERE e o que faz disto um BACKFILL e nao um
  // "escolha a cor do seu tile": quem ja tem cor calculada nao e afetado, e a
  // unica forma de trocar continua sendo reenviar a foto.
  const result = db
    .prepare(
      'UPDATE users SET avatar_color = ? WHERE id = ? AND avatar_path IS NOT NULL AND avatar_color IS NULL',
    )
    .run(color, user.id);

  return NextResponse.json({ avatarColor: result.changes > 0 ? color : null });
}
