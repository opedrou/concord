// GET /api/auth/me
// 200: { id: number, username: string, isAdmin: boolean, avatarUrl: string | null }
// 401: { error: 'not_authenticated' }
//
// Campo `id` adicionado pela ONDA C — precisa dele pra montar a URL do
// proprio avatar (GET /api/avatars/:id) sem depender de outra chamada.
// Aditivo: quem so lia username/isAdmin continua funcionando igual.
//
// Campo `avatarUrl` adicionado pra corrigir o bug do F5: `AuthUser` (vindo
// de `getAuthUser`) não carrega `avatar_path`, então buscamos direto aqui —
// mais barato que estender o contrato de `lib/auth.ts`, que é usado por toda
// rota autenticada, só por causa de um campo que só essa rota precisa.
// Já vem versionada (`avatarUrlFor`), então a página de perfil não precisa
// mais inventar cache-busting na mão.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { avatarUrlFor } from '@/lib/avatars';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  const row = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(auth.user.id) as
    | { avatar_path: string | null }
    | undefined;

  return NextResponse.json({
    id: auth.user.id,
    username: auth.user.username,
    isAdmin: auth.user.isAdmin,
    avatarUrl: avatarUrlFor(auth.user.id, row?.avatar_path ?? null),
  });
}
