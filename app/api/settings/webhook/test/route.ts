// Botão "Testar webhook": dispara UM POST assinado no webhook configurado e
// conta ao admin como foi. Só admin.
//
// É a única rota do projeto que faz uma requisição de saída para um endereço
// que o usuário escolheu, então ela é a parte perigosa da feature: sem
// cuidado, vira um proxy para varrer a rede interna a partir de dentro
// (SSRF). As defesas moram em lib/webhook.ts#deliverWebhook e são quatro —
// https obrigatório + recusa de IP não-público (IPv4 e IPv6, inclusive
// IPv4-mapped), nenhum redirect seguido, timeout curto, e nada da resposta do
// webhook devolvido ao cliente.
//
// Esse último ponto é fácil de errar: app/api/record/start/route.ts devolve
// `error.message` do SDK direto no corpo da resposta, e é exatamente o que NÃO
// se faz aqui — o que a rota devolve é um resultado grosso (`ok`, `status`,
// `error`), nunca o corpo nem os headers do que o webhook respondeu. Vazar a
// resposta desfaria a checagem de SSRF: bloquear a conexão para 10.0.0.5 não
// adianta nada se dá pra ler o que 10.0.0.5 respondeu por outro caminho.
//
// TOCTOU: a validação resolve o DNS e só então conecta, e o `fetch` resolve o
// nome de novo — a janela entre as duas resoluções é conhecida e aceita (ver o
// comentário longo em lib/webhook.ts). Não vale um agente HTTP customizado
// para uma URL que só um admin grava, numa rede doméstica.
//
// POST /api/settings/webhook/test   (admin)
//   Sem corpo.
//   200: { ok: boolean, status?: number, error?: 'timeout' | 'blocked' |
//          'redirect' | 'network' | 'not_configured' | 'no_secret' }
//   401/403: sem sessão / não-admin
//
//   Sempre 200 quando autorizado, inclusive quando o disparo falha: a
//   requisição ao Concord deu certo: o que pode ter dado errado é o disparo
//   para fora, e isso é o CONTEÚDO da resposta, não o status dela.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { DbAppSettings, getDb } from '@/lib/db';
import { deliverWebhook } from '@/lib/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const db = getDb();
  const row = db
    .prepare('SELECT call_webhook_url, call_webhook_secret FROM app_settings WHERE id = 1')
    .get() as unknown as
    | Pick<DbAppSettings, 'call_webhook_url' | 'call_webhook_secret'>
    | undefined;

  const url = row?.call_webhook_url ?? null;
  const secret = row?.call_webhook_secret ?? null;
  if (!url) {
    return NextResponse.json({ ok: false, error: 'not_configured' });
  }
  if (!secret) {
    // Sem segredo não dá pra assinar, e mandar um POST sem assinatura ensinaria
    // o n8n a aceitar requisição não autenticada. Melhor não disparar.
    return NextResponse.json({ ok: false, error: 'no_secret' });
  }

  // MESMO FORMATO do payload real (item C3), pro fluxo do n8n já poder ser
  // montado contra ele — com `test: true` na frente, para ninguém confundir
  // isto com uma chamada de verdade. Os campos de chamada vêm vazios/nulos
  // justamente porque ninguém foi chamado.
  const payload = {
    test: true,
    caller: auth.user.username,
    called: [] as string[],
    channel: null,
    channelUrl: null,
    at: new Date().toISOString(),
  };

  const result = await deliverWebhook(url, secret, payload);
  return NextResponse.json(result);
}
