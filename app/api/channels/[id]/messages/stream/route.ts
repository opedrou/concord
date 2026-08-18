// GET /api/channels/:id/messages/stream
//   Entrega em tempo real de mensagens novas/apagadas de um canal de texto,
//   via Server-Sent Events (SSE).
//
//   Por que SSE em vez de data channel do LiveKit: canal de texto precisa
//   funcionar mesmo sem ninguém conectado a uma sala do LiveKit (o canal de
//   texto nem tem sala — ver connection-details, que recusa token pra canal
//   type='text'). Data channel só existe dentro de uma Room conectada, então
//   não serve pra isso. Por que SSE em vez de WebSocket: é só entrega
//   servidor->cliente (mensagem nova/apagada) — não precisa de canal
//   bidirecional, e SSE é um `fetch` comum (GET + `ReadableStream`), então
//   atravessa o Cloudflare Tunnel + Traefik do deploy sem nenhuma config de
//   upgrade de protocolo adicional. Por que não polling: 4s de latência é
//   aceitável pra presença (já usado em usePresencePolling), mas ruim pra
//   troca de mensagens — SSE dá entrega quase instantânea sem esse custo.
//
//   Cada cliente conectado segura um handler Node aberto (rota roda em
//   runtime nodejs, não edge) — por isso o heartbeat abaixo e o cleanup no
//   `abort` do request são obrigatórios: sem heartbeat, um proxy no meio do
//   caminho (Cloudflare Tunnel, Traefik) considera a conexão ociosa e a
//   derruba silenciosamente; sem cleanup no abort, cada aba fechada sem que
//   o servidor perceba vaza um listener no EventEmitter do lib/messageBus.
//
//   200: text/event-stream. Eventos `event: message` com data JSON:
//     { type: 'created', message: {...} } | { type: 'deleted', messageId, channelId }
//   Linhas `: ping` a cada 25s (comentário SSE, ignorado pelo EventSource,
//   só existe pra manter a conexão viva atrás de proxy).
//   401: { error: 'not_authenticated' }   (resposta JSON normal, sem SSE)
//   404: { error: 'not_found' }
//   400: { error: 'not_a_text_channel' }
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { DbChannel, getDb } from '@/lib/db';
import { subscribeToChannel } from '@/lib/messageBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 25_000;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as unknown as
    | DbChannel
    | undefined;
  if (!channel) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (channel.type !== 'text') {
    return NextResponse.json({ error: 'not_a_text_channel' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller já fechado (cliente desconectou entre o evento e o
          // enqueue) — ignora, o cleanup abaixo já cuida do resto.
        }
      };

      // Comentário inicial: força o proxy a liberar os headers de resposta
      // na hora, em vez de segurar buffer esperando mais bytes.
      send(': connected\n\n');

      unsubscribe = subscribeToChannel(id, (event) => {
        send(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
      });

      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_INTERVAL_MS);

      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          // já fechado
        }
      };

      // Aba fechada / navegação embora: o fetch subjacente aborta o signal.
      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      // Cliente cancelou o stream do lado dele (ex.: EventSource.close()) —
      // mesma limpeza, caminho alternativo ao abort acima.
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Desliga qualquer buffering de proxy reverso no meio do caminho
      // (nginx-like); Traefik não bufferiza por padrão, mas não custa nada.
      'X-Accel-Buffering': 'no',
    },
  });
}
