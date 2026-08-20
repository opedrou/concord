// GET /api/channels/:id/messages?before=<messageId>&limit=<n>
//   Histórico de mensagens de um canal de texto, paginado pra trás (mais
//   recentes primeiro na consulta, devolvidas em ordem cronológica). Sem
//   `before`, devolve a página mais recente. Com `before=<id>`, devolve as
//   `limit` mensagens imediatamente anteriores àquele id — é assim que o
//   cliente carrega mais histórico ao rolar pra cima.
//   `limit` default 50, máximo 100 — nunca devolve a tabela inteira de uma vez.
//   200: { messages: Array<{ id, channelId, authorId, authorName, content, createdAt }>, hasMore: boolean }
//   400: { error: 'invalid_query' } | { error: 'not_a_text_channel' }
//   401: { error: 'not_authenticated' }
//   404: { error: 'not_found' }
//
// POST /api/channels/:id/messages
//   Body: { content: string }  — autor é SEMPRE o usuário da sessão (nunca
//   vem do body, mesmo padrão do token do LiveKit em connection-details).
//   Rejeita conteúdo vazio/só espaço e acima do limite de tamanho.
//   201: { id, channelId, authorId, authorName, content, createdAt }
//   400: { error: 'invalid_body' } | { error: 'not_a_text_channel' }
//   401: { error: 'not_authenticated' }
//   404: { error: 'not_found' }
import fs from 'node:fs';
import nodePath from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { DbChannel, DbMessage, getDb } from '@/lib/db';
import { ATTACHMENTS_DIR, attachmentUrlFor } from '@/lib/attachments';
import { publishChannelEvent } from '@/lib/messageBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mesmo limite que o Discord usa como referência de bom senso pra um campo
// de texto simples (sem anexos) — suficiente pra qualquer mensagem real,
// curto o bastante pra não virar vetor de abuso do SQLite/da UI.
const MAX_MESSAGE_LENGTH = 4000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

interface PublicAttachment {
  url: string;
  name: string;
  mime: string;
  kind: string;
  size: number;
}

interface PublicMessage {
  id: number;
  channelId: number;
  authorId: number | null;
  authorName: string;
  content: string;
  createdAt: number;
  attachment: PublicAttachment | null;
}

interface MessageRow extends DbMessage {
  author_name: string | null;
}

function toPublicAttachment(row: MessageRow): PublicAttachment | null {
  if (!row.attachment_path) {
    return null;
  }
  return {
    url: attachmentUrlFor(row.id, row.attachment_path),
    name: row.attachment_name ?? 'arquivo',
    mime: row.attachment_mime ?? 'application/octet-stream',
    kind: row.attachment_kind ?? 'file',
    size: row.attachment_size ?? 0,
  };
}

function toPublicMessage(row: MessageRow): PublicMessage {
  return {
    attachment: toPublicAttachment(row),
    id: row.id,
    channelId: row.channel_id,
    authorId: row.user_id,
    // Autor pode ter sido apagado desde então (user_id vira NULL via ON
    // DELETE SET NULL) — mostra um rótulo genérico em vez de quebrar a UI.
    authorName: row.author_name ?? 'Usuário removido',
    content: row.content,
    createdAt: row.created_at,
  };
}

/** Carrega o canal e garante que é de texto. Retorna a resposta de erro pronta ou o canal. */
function loadTextChannel(
  db: ReturnType<typeof getDb>,
  id: number,
): { channel: DbChannel } | { response: NextResponse } {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as unknown as
    | DbChannel
    | undefined;
  if (!channel) {
    return { response: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  if (channel.type !== 'text') {
    return { response: NextResponse.json({ error: 'not_a_text_channel' }, { status: 400 }) };
  }
  return { channel };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const loaded = loadTextChannel(db, id);
  if ('response' in loaded) return loaded.response;

  const beforeParam = request.nextUrl.searchParams.get('before');
  let before: number | null = null;
  if (beforeParam !== null) {
    before = Number(beforeParam);
    if (!Number.isInteger(before) || before <= 0) {
      return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
    }
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  let limit = DEFAULT_PAGE_SIZE;
  if (limitParam !== null) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit <= 0) {
      return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
    }
    limit = Math.min(limit, MAX_PAGE_SIZE);
  }

  // Busca `limit + 1` pra saber se tem mais história além dessa página, sem
  // um segundo COUNT(*) só pra isso. Ordena DESC (mais nova primeiro) pra
  // pegar exatamente as `limit` anteriores ao cursor, depois inverte pra
  // ordem cronológica na resposta.
  const rows = (before === null
    ? db
        .prepare(
          `SELECT messages.*, users.username AS author_name
             FROM messages LEFT JOIN users ON users.id = messages.user_id
             WHERE messages.channel_id = ?
             ORDER BY messages.id DESC
             LIMIT ?`,
        )
        .all(id, limit + 1)
    : db
        .prepare(
          `SELECT messages.*, users.username AS author_name
             FROM messages LEFT JOIN users ON users.id = messages.user_id
             WHERE messages.channel_id = ? AND messages.id < ?
             ORDER BY messages.id DESC
             LIMIT ?`,
        )
        .all(id, before, limit + 1)) as unknown as MessageRow[];

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();

  return NextResponse.json({ messages: page.map(toPublicMessage), hasMore });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const loaded = loadTextChannel(db, id);
  if ('response' in loaded) return loaded.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { content, attachment } = (body ?? {}) as { content?: unknown; attachment?: unknown };
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const trimmed = content.trim();
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // O anexo já está no disco (ver POST /api/attachments) — aqui só amarramos
  // ele à mensagem. Validamos que o arquivo EXISTE de verdade em vez de
  // confiar no corpo: `path` vem do cliente, e sem essa checagem daria pra
  // criar mensagem apontando pra um arquivo qualquer (ou pra nada).
  let saved: { path: string; name: string; mime: string; kind: string; size: number } | null = null;
  if (attachment !== undefined && attachment !== null) {
    const candidate = attachment as Record<string, unknown>;
    if (typeof candidate.path !== 'string' || !candidate.path) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    // `path.basename` no resolve impede sair do diretório; aqui só checamos
    // presença.
    if (!fs.existsSync(nodePath.join(ATTACHMENTS_DIR, nodePath.basename(candidate.path)))) {
      return NextResponse.json({ error: 'attachment_not_found' }, { status: 400 });
    }
    saved = {
      path: nodePath.basename(candidate.path),
      name: typeof candidate.name === 'string' ? candidate.name.slice(0, 120) : 'arquivo',
      mime: typeof candidate.mime === 'string' ? candidate.mime : 'application/octet-stream',
      kind: typeof candidate.kind === 'string' ? candidate.kind : 'file',
      size: typeof candidate.size === 'number' ? candidate.size : 0,
    };
  }

  // Mensagem VAZIA agora é válida, desde que tenha anexo — mandar só uma foto,
  // sem legenda, é o caso mais comum de anexo e antes era recusado aqui.
  if (!trimmed && !saved) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const createdAt = Date.now();
  const result = db
    .prepare(
      `INSERT INTO messages
         (channel_id, user_id, content, created_at,
          attachment_path, attachment_name, attachment_mime, attachment_kind, attachment_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // Autor SEMPRE da sessão — nunca de campo do body, mesma regra do token do LiveKit.
    .run(
      id,
      user.id,
      trimmed,
      createdAt,
      saved?.path ?? null,
      saved?.name ?? null,
      saved?.mime ?? null,
      saved?.kind ?? null,
      saved?.size ?? null,
    );

  const messageId = Number(result.lastInsertRowid);
  const publicMessage: PublicMessage = {
    id: messageId,
    channelId: id,
    authorId: user.id,
    authorName: user.username,
    content: trimmed,
    createdAt,
    attachment: saved
      ? {
          url: attachmentUrlFor(messageId, saved.path),
          name: saved.name,
          mime: saved.mime,
          kind: saved.kind,
          size: saved.size,
        }
      : null,
  };

  // Entrega em tempo real pra quem estiver com o canal aberto agora (ver
  // app/api/channels/[id]/messages/stream/route.ts e lib/messageBus.ts).
  publishChannelEvent(id, { type: 'created', message: publicMessage });

  return NextResponse.json(publicMessage, { status: 201 });
}
