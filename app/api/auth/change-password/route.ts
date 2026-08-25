// POST /api/auth/change-password   (qualquer usuário logado — só a própria senha)
//   Body: { currentPassword: string, newPassword: string, confirmPassword: string }
//   200: { ok: true }   + Set-Cookie: session (reemitido, ver abaixo)
//   400: { error: 'invalid_body' } — corpo malformado ou campo faltando
//   400: { error: 'password_too_short', reason } — newPassword menor que o mínimo (lib/passwordPolicy.ts)
//   400: { error: 'password_too_weak', reason } — senha comum, sequência de teclado,
//        caractere repetido, ou contendo o próprio nome de usuário
//   400: { error: 'password_mismatch' } — confirmPassword != newPassword
//   401: { error: 'not_authenticated' } — sem sessão
//   401: { error: 'wrong_password' } — currentPassword não bate com o hash salvo
//
// O usuário-alvo é sempre o da sessão (auth.user.id) — não existe id no
// corpo da requisição, então não tem como trocar senha de outra conta por
// aqui. Exige a senha atual pra evitar que um cookie de sessão roubado vire
// sequestro permanente da conta (troca de senha some com o acesso de quem
// não tem a senha, mesmo com o cookie).
//
// Trocar a senha incrementa users.session_version (S5), o que mata na hora
// todos os cookies emitidos antes — inclusive o roubado, e inclusive os
// outros dispositivos da própria pessoa. Por isso a resposta reemite o cookie
// de quem acabou de trocar, já com a versão nova: senão ela seria deslogada
// de si mesma no próximo request.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { buildSessionCookie, hashPassword, verifyPassword } from '@/lib/auth';
import { DbUser, getDb } from '@/lib/db';
import { checkPassword } from '@/lib/passwordPolicy';

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
  // mesma regra que POST/PATCH /api/users (ver lib/passwordPolicy.ts)
  const problem = checkPassword(newPassword, user.username);
  if (problem) {
    return NextResponse.json({ error: problem.code, reason: problem.reason }, { status: 400 });
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
  db.prepare(
    'UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?',
  ).run(newHash, user.id);

  const cookie = await buildSessionCookie(user.id, row.session_version + 1);
  return NextResponse.json({ ok: true }, { status: 200, headers: { 'Set-Cookie': cookie } });
}
