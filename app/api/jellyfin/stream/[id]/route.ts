// GET /api/jellyfin/stream/:itemId
//   Proxy do stream de vídeo do Jellyfin (W3). É por AQUI que o vídeo passa —
//   a credencial do Jellyfin fica no servidor e o navegador só vê esta rota.
//
//   RANGE É O PONTO DA ROTA, NÃO UM DETALHE
//   ---------------------------------------
//   Sem `Range` não há seek: o <video> precisa pedir "me dá do byte X" pra
//   pular. Então o header do cliente é repassado tal e qual, e o 206 do
//   Jellyfin volta com Content-Range e Accept-Ranges intactos. Existe bug
//   documentado de `Accept-Ranges: none` no Jellyfin (#15524), confirmado só
//   pra áudio — se aparecer em vídeo, o seek fica impreciso e é aqui que se vê.
//
//   O corpo é repassado como STREAM (`response.body`), nunca bufferizado: um
//   filme de 8 GB na memória do Node derrubaria o processo.
//
//   200/206: os bytes do vídeo
//   401: { error: 'not_authenticated' }
//   503: { error: 'jellyfin_indisponivel' }
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { forgetJellyfinSession, jellyfinConfigured, jellyfinStreamUrl } from '@/lib/jellyfin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** O que faz sentido repassar do Jellyfin pro navegador. */
const PASSTHROUGH = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'etag',
  'last-modified',
];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  if (!jellyfinConfigured()) {
    return NextResponse.json({ error: 'jellyfin_indisponivel' }, { status: 503 });
  }

  const { id } = await params;
  // O id vem na URL; só aceitamos o formato de id do Jellyfin (hex de 32) pra
  // não virar um proxy pra caminho arbitrário do servidor de mídia.
  if (!/^[0-9a-f]{32}$/i.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let upstream: Response;
  try {
    const headers: HeadersInit = {};
    const range = request.headers.get('range');
    if (range) {
      headers.Range = range;
    }
    upstream = await fetch(await jellyfinStreamUrl(id), { headers, cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'jellyfin_indisponivel' }, { status: 503 });
  }

  if (upstream.status === 401) {
    forgetJellyfinSession();
    return NextResponse.json({ error: 'jellyfin_indisponivel' }, { status: 503 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: 'jellyfin_indisponivel' }, { status: 503 });
  }

  const headers = new Headers();
  for (const name of PASSTHROUGH) {
    const value = upstream.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
