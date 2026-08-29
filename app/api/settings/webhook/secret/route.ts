// Geração do segredo que assina o POST do webhook. Só admin.
//
// O segredo é gerado NO SERVIDOR (`crypto.randomBytes`, ver
// lib/webhook.ts#generateWebhookSecret) — nunca no navegador, nunca com
// `Math.random()`. Ele é o par compartilhado entre este servidor e o n8n: é com
// ele que o n8n confere que o POST veio daqui.
//
// ESTA É A ÚNICA RESPOSTA DA API QUE CONTÉM O SEGREDO. Depois deste POST, o
// valor só existe no banco; o GET /api/settings/webhook devolve apenas
// `hasSecret: boolean`. Mesma postura que a rota já tem com a URL, e pela mesma
// razão: um valor que fica sendo devolvido a cada abertura do painel tem N
// chances de vazar (log de proxy, extensão do navegador, print de tela) em vez
// de uma. Se o Pedro perder o segredo, ele gera outro aqui e cola o novo no
// n8n — os dois lados TÊM que ter o mesmo valor, então regenerar quebra o
// webhook até o n8n ser atualizado.
//
// POST /api/settings/webhook/secret   (admin)
//   Sem corpo. Gera (ou regenera) e grava.
//   200: { secret: string, hasSecret: true }   — única vez que `secret` aparece
//   401/403: sem sessão / não-admin
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getDb } from '@/lib/db';
import { generateWebhookSecret } from '@/lib/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const secret = generateWebhookSecret();
  const db = getDb();
  db.prepare('UPDATE app_settings SET call_webhook_secret = ? WHERE id = 1').run(secret);

  // `no-store` explícito pra nenhum proxy no caminho guardar cópia do único
  // response que carrega o valor.
  return NextResponse.json(
    { secret, hasSecret: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
