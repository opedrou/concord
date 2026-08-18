// Helpers repetidos em toda rota de API que exige sessão/admin. Centraliza
// aqui pra cada `route.ts` checar autorização no servidor, sempre — nunca
// confiar só no middleware ou no que a UI decide mostrar/esconder.
import { NextRequest, NextResponse } from 'next/server';
import { AuthUser, getAuthUser } from './auth';

/** Retorna o usuário autenticado ou já responde 401. */
export async function requireUser(
  request: NextRequest,
): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const user = await getAuthUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  }
  return { user };
}

/** Retorna o usuário autenticado se for admin; senão já responde 401/403. */
export async function requireAdmin(
  request: NextRequest,
): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const user = await getAuthUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
  }
  if (!user.isAdmin) {
    return { response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { user };
}
