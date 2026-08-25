// POST /api/auth/login
// Body: { username: string, password: string }
// 200: { username: string, isAdmin: boolean }              + Set-Cookie: session
// 400: { error: 'invalid_body' }                              — campos faltando
// 401: { error: 'invalid_credentials' }                        — usuário ou senha errados
// 429: { error: 'too_many_attempts' }         + Retry-After — muitas falhas seguidas
//
// Não revela se o usuário existe ou não: mesma mensagem/status pros dois casos,
// e o mesmo tempo de resposta (ver DUMMY_HASH abaixo).
import { NextRequest, NextResponse } from 'next/server';
import { buildSessionCookie, verifyPassword } from '@/lib/auth';
import { DbUser, getDb } from '@/lib/db';
import { clearAttempts, recordFailure, retryAfterSeconds } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hash fixo, no formato do hashPassword (scrypt, `salt:key` em hex), de uma
// senha que não é de ninguém. É público de propósito: só serve pra gastar o
// mesmo tempo de CPU quando o usuário não existe, senão o curto-circuito do
// `||` faria o scrypt nunca rodar e o relógio entregaria quais contas existem.
const DUMMY_HASH =
  'b633695cdf3ef5fab6f71b0a0e57583d:607dabe36c8543e44ce7b5d390be22c17baafb911cecb498f9fbf650335060edf11367332a492905abfffc8239f61429b9eb62af82e2e551f013b477a99c023d';

// A app fica atrás do Cloudflare Tunnel, então o IP do socket é sempre o do
// túnel; o real vem no primeiro valor do X-Forwarded-For. Só o primeiro: o
// resto da lista é texto que o cliente pode inventar. Sem o header (acesso
// direto, teste local), cai num rótulo fixo — o pior caso é várias pessoas
// compartilharem o mesmo balde, e a chave ainda inclui o username.
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const rateKey = `${clientIp(request)}|${username}`;
  const retryAfter = retryAfterSeconds(rateKey);
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: 'too_many_attempts' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | DbUser
    | undefined;

  // Sem `||` curto-circuitando: o scrypt roda sempre, contra o hash da conta
  // ou contra o dummy. Quando não há linha o resultado é jogado fora — ele só
  // existe pra pagar o mesmo custo de CPU.
  const passwordOk = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);

  // Mensagem/status idênticos pra usuário inexistente e senha errada — não
  // dá pra usar isso pra enumerar contas.
  if (!row || !passwordOk) {
    recordFailure(rateKey);
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  }

  clearAttempts(rateKey);
  const cookie = await buildSessionCookie(row.id, row.session_version);
  return NextResponse.json(
    { username: row.username, isAdmin: row.is_admin === 1 },
    { status: 200, headers: { 'Set-Cookie': cookie } },
  );
}
