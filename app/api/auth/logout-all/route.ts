// POST /api/auth/logout-all   (qualquer usuário logado — só a própria conta)
//   Sai de todos os dispositivos: incrementa users.session_version (S5), o que
//   invalida na hora todo cookie de sessão já emitido pra essa conta, e zera
//   o cookie de quem chamou.
//   200: { ok: true }   + Set-Cookie que zera a sessão
//   401: { error: 'not_authenticated' } — sem sessão
//
// Sai de graça junto da revogação por versão: é o mesmo UPDATE que a troca de
// senha faz. Não existe UI pra isso ainda — a rota é o mecanismo.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { buildLogoutCookie } from '@/lib/auth';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(
    auth.user.id,
  );

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { 'Set-Cookie': buildLogoutCookie() } },
  );
}
