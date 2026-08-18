// POST /api/auth/change-password   (qualquer usuário logado — só a própria senha)
//   Body: { currentPassword: string, newPassword: string, confirmPassword: string }
//   200: { ok: true }
//   400: { error: 'invalid_body' } — corpo malformado ou campo faltando
//   400: { error: 'password_too_short' } — newPassword com menos de 8 caracteres
//   400: { error: 'password_mismatch' } — confirmPassword != newPassword
//   401: { error: 'not_authenticated' } — sem sessão
//   401: { error: 'wrong_password' } — currentPassword não bate com o hash salvo
//
// O usuário-alvo é sempre o da sessão (auth.user.id) — não existe id no
// corpo da requisição, então não tem como trocar senha de outra conta por
// aqui. Exige a senha atual pra evitar que um cookie de sessão roubado vire
// sequestro permanente da conta (troca de senha some com o acesso de quem
// não tem a senha, mesmo com o cookie).
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { DbUser, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { currentPassword, newPassword, confirmPassword } = (body ?? {}) as {
    currentPassword?: unknown;
    newPassword?: unknown;
    confirmPassword?: unknown;
  };
  if (
    typeof currentPassword !== 'string' ||
    !currentPassword ||
    typeof newPassword !== 'string' ||
    typeof confirmPassword !== 'string'
  ) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  // mesma regra minima que POST/PATCH /api/users (ver app/api/users/route.ts)
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: 'password_mismatch' }, { status: 400 });
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as
    | DbUser
    | undefined;
  if (!row) {
    // Sessão válida mas usuário sumiu do banco entre a checagem e agora —
    // trata como não autenticado.
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  if (!verifyPassword(currentPassword, row.password_hash)) {
    return NextResponse.json({ error: 'wrong_password' }, { status: 401 });
  }

  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

  return NextResponse.json({ ok: true });
}
