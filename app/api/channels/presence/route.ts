// GET /api/channels/presence
//   Quem está em cada canal agora. Qualquer usuário logado — é o que
//   alimenta "ver quem tá dentro sem entrar". Pensado pra polling de poucos
//   em poucos segundos por cliente, então minimiza chamadas ao SFU: só uma
//   `listRooms()` (lista as salas ativas de uma vez) + `listParticipants()`
//   apenas para as salas que de fato têm gente e correspondem a um canal
//   nosso — nunca uma chamada por canal cadastrado.
//
//   200: {
//     channels: Array<{ id, slug, participants: Array<{ identity, name, muted, camera, screenShare }> }>,
//     degraded?: true   // presente se o SFU não respondeu; participantes vêm vazios, não é erro
//   }
//   401: { error: 'not_authenticated' }
//
//   Sala do LiveKit é efêmera (só existe com gente dentro) — sala inexistente
//   é presença vazia, nunca 404/erro. Falha do SFU (rede, timeout, etc.)
//   também não derruba a resposta: cai pra `degraded: true` com tudo vazio.
import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient, TrackSource, type ParticipantInfo } from 'livekit-server-sdk';
import { requireUser } from '@/lib/api-auth';
import { DbChannel, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

interface PresenceParticipantPayload {
  identity: string;
  name: string;
  /** Sem microfone publicado, ou publicado e mudo. */
  muted: boolean;
  /** Camera publicada e nao muda. */
  camera: boolean;
  /** Compartilhando tela agora. */
  screenShare: boolean;
}

/** Deriva o estado visivel de um participante a partir das tracks que o SFU
 * ja devolve no `listParticipants()`. Antes isso era descartado (so identity e
 * name passavam), e por isso a sidebar nao tinha como mostrar mudo/camera/live.
 * Nao custa nenhuma chamada extra ao SFU — os dados vem no mesmo payload.
 *
 * `muted` inclui o caso "nem publicou microfone": pra quem olha a lista, sem
 * mic publicado e mudo tem exatamente o mesmo significado (essa pessoa nao vai
 * falar), e distinguir os dois so geraria um terceiro estado sem uso. */
function describeParticipant(p: ParticipantInfo): PresenceParticipantPayload {
  const tracks = p.tracks ?? [];
  const mic = tracks.find((t) => t.source === TrackSource.MICROPHONE);
  const cam = tracks.find((t) => t.source === TrackSource.CAMERA);
  return {
    identity: p.identity,
    name: p.name,
    muted: !mic || mic.muted,
    camera: !!cam && !cam.muted,
    // Screen share nao tem estado "mudo" util aqui: ou a track existe (esta
    // transmitindo) ou nao existe.
    screenShare: tracks.some((t) => t.source === TrackSource.SCREEN_SHARE),
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  // Só canais de voz têm sala no LiveKit — canal de texto nunca aparece
  // aqui (não faz sentido consultar presença de algo que não conecta).
  const channels = db
    .prepare("SELECT * FROM channels WHERE type = 'voice' ORDER BY position ASC, id ASC")
    .all() as unknown as DbChannel[];

  const bySlug = new Map(
    channels.map((c) => [
      c.slug,
      { id: c.id, slug: c.slug, participants: [] as PresenceParticipantPayload[] },
    ]),
  );

  if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
    // Config ausente não deve derrubar a página — devolve tudo vazio.
    return NextResponse.json({ channels: Array.from(bySlug.values()), degraded: true });
  }

  try {
    const client = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);
    const activeRooms = await client.listRooms();
    const relevantRoomNames = activeRooms.map((r) => r.name).filter((name) => bySlug.has(name));

    // listParticipants só para as salas ativas que correspondem a um canal —
    // se ninguém tá em nenhum canal, isso é zero chamadas extras.
    await Promise.all(
      relevantRoomNames.map(async (roomName) => {
        try {
          const participants = await client.listParticipants(roomName);
          const entry = bySlug.get(roomName);
          if (entry) {
            entry.participants = participants.map(describeParticipant);
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
