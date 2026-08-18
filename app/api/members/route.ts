// GET /api/members   (qualquer usuário logado)
//   Lista pública de membros — o mínimo necessário pra montar a lista
//   lateral estilo Discord (avatar + nome de todo mundo cadastrado, não só
//   quem está numa call). Deliberadamente separada de GET /api/users
//   (admin-only, expõe createdAt/isAdmin pra gestão de contas): aqui nunca
//   devolvemos password_hash nem is_admin — só o que qualquer colega pode
//   ver de qualquer outro colega.
//
//   200: Array<{ id, username, avatarUrl: string | null }>
//   401: { error: 'not_authenticated' }
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { DbUser, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  const rows = db
    .prepare('SELECT id, username, avatar_path FROM users ORDER BY username ASC')
    .all() as unknown as Pick<DbUser, 'id' | 'username' | 'avatar_path'>[];

  const members = rows.map((row) => ({
    id: row.id,
    username: row.username,
    // URL da rota que serve o arquivo, não o caminho em disco — o cliente
    // nunca precisa (nem deve) saber onde/como o avatar está guardado.
    avatarUrl: row.avatar_path ? `/api/avatars/${row.id}` : null,
  }));

  return NextResponse.json(members);
}
