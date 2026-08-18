// GET /api/auth/me
// 200: { id: number, username: string, isAdmin: boolean }
// 401: { error: 'not_authenticated' }
//
// Campo `id` adicionado pela ONDA C — precisa dele pra montar a URL do
// proprio avatar (GET /api/avatars/:id) sem depender de outra chamada.
// Aditivo: quem so lia username/isAdmin continua funcionando igual.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  return NextResponse.json({
    id: auth.user.id,
    username: auth.user.username,
    isAdmin: auth.user.isAdmin,
  });
}
