// GET /api/record/stop
//   Para gravação de uma sala. Requer autenticação.
//   Query params: roomName (string, obrigatório)
//   200: gravação interrompida com sucesso
//   401: não autenticado
//   403: parâmetro roomName ausente
//   404: nenhuma gravação ativa encontrada para essa sala
//   500: erro ao parar gravação (problema com EgressClient)
import { EgressClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if ('response' in auth) return auth.response;

    const roomName = req.nextUrl.searchParams.get('roomName');

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const activeEgresses = (await egressClient.listEgress({ roomName })).filter(
      (info) => info.status < 2,
    );
    if (activeEgresses.length === 0) {
      return new NextResponse('No active recording found', { status: 404 });
    }
    await Promise.all(activeEgresses.map((info) => egressClient.stopEgress(info.egressId)));

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
