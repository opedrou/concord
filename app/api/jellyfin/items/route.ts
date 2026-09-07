// GET /api/jellyfin/items?parentId=&search=
//   Navega a biblioteca do Jellyfin (W3). Autenticado como tudo o mais — `/api`
//   está FORA do middleware, então o guard aqui é a única barreira.
//
//   A credencial do Jellyfin nunca sai daqui: o cliente recebe só id, nome,
//   tipo, ano e duração. Ver o comentário no topo de lib/jellyfin.ts.
//
//   200: { items: JellyfinItem[] }
//   401: { error: 'not_authenticated' }
//   503: { error: 'jellyfin_indisponivel' } — sem env var, ou o servidor caiu
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { jellyfinConfigured, listJellyfinItems } from '@/lib/jellyfin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  if (!jellyfinConfigured()) {
    return NextResponse.json({ error: 'jellyfin_indisponivel' }, { status: 503 });
  }

  const url = new URL(request.url);
  const parentId = url.searchParams.get('parentId') ?? undefined;
  const search = url.searchParams.get('search') ?? undefined;

  try {
    const items = await listJellyfinItems(parentId, search);
    return NextResponse.json({ items });
  } catch {
    // O erro real (auth, rede, 500 do Jellyfin) fica no servidor de propósito:
    // o cliente não precisa saber a topologia da rede pra mostrar "indisponível".
    return NextResponse.json({ error: 'jellyfin_indisponivel' }, { status: 503 });
  }
}
