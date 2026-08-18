// GET /api/avatars/:id   (qualquer usuário logado)
//   Serve o arquivo de avatar do usuário :id. Aberto a qualquer sessão
//   válida (não só ao dono) — é isso que permite a lista de membros mostrar
//   a foto de todo mundo.
//
//   200: bytes da imagem, Content-Type real + X-Content-Type-Options: nosniff
//   401: sem sessão
//   404: usuário não existe, não tem avatar, ou o arquivo sumiu do disco
import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import { contentTypeForExt, resolveAvatarPath } from '@/lib/avatars';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const db = getDb();
  const row = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(id) as
    | { avatar_path: string | null }
    | undefined;
  if (!row || !row.avatar_path) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const filePath = resolveAvatarPath(row.avatar_path);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ext = row.avatar_path.split('.').pop() ?? '';
  // NextResponse não aceita Buffer diretamente como BodyInit — Uint8Array sim.
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentTypeForExt(ext),
      // Nunca deixa o navegador "farejar" o conteúdo como outra coisa (ex.:
      // HTML/script) mesmo que o Content-Type esteja errado por algum motivo.
      'X-Content-Type-Options': 'nosniff',
      // Nome fixo e genérico — nunca o nome original enviado pelo usuário.
      'Content-Disposition': 'inline; filename="avatar"',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
