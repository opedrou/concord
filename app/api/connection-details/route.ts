// GET /api/connection-details?roomName=<slug>
//   Emite o token do LiveKit pra sessão autenticada entrar num canal.
//   `identity` e `name` do participante vêm SEMPRE da sessão (nunca de query
//   string) — antes qualquer um podia se passar por qualquer nome, esse era
//   o furo principal a fechar. `roomName` precisa bater com o `slug` de um
//   canal cadastrado no banco; nome de sala arbitrário é recusado.
//
//   200: { serverUrl, roomName, participantToken, participantName }
//   400: { error: 'missing_room_name' } | { error: 'not_a_voice_channel' }
//   401: { error: 'not_authenticated' }
//   404: { error: 'channel_not_found' }
//   500: { error: 'server_misconfigured' }
import { randomString } from '@/lib/client-utils';
import { requireUser } from '@/lib/api-auth';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { getDb } from '@/lib/db';
import { ConnectionDetails } from '@/lib/types';
import { AccessToken, AccessTokenOptions, VideoGrant } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// Postfix aleatório por conexão, só pra permitir a mesma conta entrar de mais
// de uma aba/dispositivo ao mesmo tempo sem colidir identity no LiveKit.
// Não vem de query string nem de cookie do cliente — é gerado aqui.
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  try {
    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      throw new Error('LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET não definidos');
    }

    const roomName = request.nextUrl.searchParams.get('roomName');
    if (typeof roomName !== 'string' || !roomName) {
      return NextResponse.json({ error: 'missing_room_name' }, { status: 400 });
    }

    // A sala precisa corresponder a um canal existente — recusa roomName arbitrário.
    const db = getDb();
    const channel = db.prepare('SELECT slug, type FROM channels WHERE slug = ?').get(roomName) as
      | { slug: string; type: string }
      | undefined;
    if (!channel) {
      return NextResponse.json({ error: 'channel_not_found' }, { status: 404 });
    }
    // Token do LiveKit só faz sentido pra canal de voz — canal de texto não
    // tem sala nenhuma pra entrar.
    if (channel.type !== 'voice') {
      return NextResponse.json({ error: 'not_a_voice_channel' }, { status: 400 });
    }

    const region = request.nextUrl.searchParams.get('region');
    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;

    const participantToken = await createParticipantToken(
      {
        // identity/name derivados da sessão — nunca de input do cliente.
        identity: `${user.username}__${randomString(4)}`,
        name: user.username,
      },
      roomName,
    );

    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName,
      participantToken,
      participantName: user.username,
    };
    return NextResponse.json(data);
  } catch (error) {
    console.error('[connection-details] erro:', error);
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  at.ttl = '5m';
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}
