// GET /api/channels/presence
//   Quem está em cada canal agora. Qualquer usuário logado — é o que
//   alimenta "ver quem tá dentro sem entrar". Pensado pra polling de poucos
//   em poucos segundos por cliente, então minimiza chamadas ao SFU: só uma
//   `listRooms()` (lista as salas ativas de uma vez) + `listParticipants()`
//   apenas para as salas que de fato têm gente e correspondem a um canal
//   nosso — nunca uma chamada por canal cadastrado.
//
//   200: {
//     channels: Array<{ id, slug, participants: Array<{ identity, name }> }>,
//     degraded?: true   // presente se o SFU não respondeu; participantes vêm vazios, não é erro
//   }
//   401: { error: 'not_authenticated' }
//
//   Sala do LiveKit é efêmera (só existe com gente dentro) — sala inexistente
//   é presença vazia, nunca 404/erro. Falha do SFU (rede, timeout, etc.)
//   também não derruba a resposta: cai pra `degraded: true` com tudo vazio.
import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { requireUser } from '@/lib/api-auth';
import { DbChannel, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  // Só canais de voz têm sala no LiveKit — canal de texto nunca aparece
  // aqui (não faz sentido consultar presença de algo que não conecta).
  const channels = db
    .prepare("SELECT * FROM channels WHERE type = 'voice' ORDER BY position ASC, id ASC")
    .all() as unknown as DbChannel[];

  const bySlug = new Map(channels.map((c) => [c.slug, { id: c.id, slug: c.slug, participants: [] as { identity: string; name: string }[] }]));

  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
    // Config ausente não deve derrubar a página — devolve tudo vazio.
    return NextResponse.json({ channels: Array.from(bySlug.values()), degraded: true });
  }

  try {
    const client = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
    const activeRooms = await client.listRooms();
    const relevantRoomNames = activeRooms
      .map((r) => r.name)
      .filter((name) => bySlug.has(name));

    // listParticipants só para as salas ativas que correspondem a um canal —
    // se ninguém tá em nenhum canal, isso é zero chamadas extras.
    await Promise.all(
      relevantRoomNames.map(async (roomName) => {
        try {
          const participants = await client.listParticipants(roomName);
          const entry = bySlug.get(roomName);
          if (entry) {
            entry.participants = participants.map((p) => ({ identity: p.identity, name: p.name }));
          }
        } catch {
          // Sala pode ter esvaziado entre o listRooms e o listParticipants —
          // trata como presença vazia, não propaga erro.
        }
      }),
    );

    return NextResponse.json({ channels: Array.from(bySlug.values()) });
  } catch (err) {
    console.error('[presence] falha ao consultar o LiveKit:', err);
    return NextResponse.json({ channels: Array.from(bySlug.values()), degraded: true });
  }
}
