// Webhook de "chamar pessoas": leitura de ESTADO e escrita da URL. Só admin.
//
// A URL é um segredo. Ela quase sempre carrega o token de autenticação
// embutido (`https://hook.exemplo/abc?token=...`, o formato do n8n e do Home
// Assistant), então esta rota NUNCA devolve a URL inteira — nem para o admin
// que acabou de gravá-la. É a mesma decisão que GET /api/members já toma com
// `password_hash`: o valor mora no banco e sai de lá só na hora de usar.
//
// O que o GET devolve no lugar é `{ configured, host }`, onde `host` é só o
// `URL.host` ("hook.exemplo"). Isso existe pro admin conseguir conferir que
// salvou no destino certo — sem que o segredo trafegue de volta pro navegador
// em toda abertura do painel. Path, query string e userinfo ficam de fora de
// propósito: é justamente neles que o token mora.
//
// O segredo de assinatura (HMAC, ver lib/webhook.ts) segue a mesma postura,
// só que mais estrita: o valor sai UMA vez, na resposta do POST que o gera
// (app/api/settings/webhook/secret), e nunca mais. Aqui só aparece o
// `hasSecret`.
//
// GET /api/settings/webhook   (admin)
//   200: { configured: boolean, host: string | null, hasSecret: boolean }
//   401/403: sem sessão / não-admin
//
// PUT /api/settings/webhook   (admin)
//   Body: { url: string | null }  — obrigatório; string vazia ou null apaga
//   (grava NULL). Não existe DELETE separado: é um campo só, e "salvar vazio"
//   já é a operação de limpar.
//   200: { configured, host, hasSecret }   (mesmo shape do GET)
//   400: { error: 'invalid_body' }   — corpo não-JSON ou `url` de tipo errado
//   400: { error: 'invalid_url' }    — não parseia, ou não é https
//   401/403: sem sessão / não-admin
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { DbAppSettings, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readWebhookRow(): Pick<DbAppSettings, 'call_webhook_url' | 'call_webhook_secret'> {
  const db = getDb();
  // A linha id = 1 é criada no boot pelo getDb(), então ela existe sempre; os
  // `?? null` cobrem só o caso teórico de um banco mexido na mão.
  const row = db
    .prepare('SELECT call_webhook_url, call_webhook_secret FROM app_settings WHERE id = 1')
    .get() as unknown as
    | Pick<DbAppSettings, 'call_webhook_url' | 'call_webhook_secret'>
    | undefined;
  return {
    call_webhook_url: row?.call_webhook_url ?? null,
    call_webhook_secret: row?.call_webhook_secret ?? null,
  };
}

/**
 * A resposta pública: estado e destino, nunca os segredos. Nem a URL nem o
 * valor do segredo passam por aqui — só a informação de que existem.
 */
function toPublicState(url: string | null, secret: string | null) {
  const hasSecret = Boolean(secret);
  if (!url) {
    return { configured: false, host: null, hasSecret };
  }
  // A URL guardada já passou pela validação do PUT, mas parsear de novo aqui
  // custa nada e evita explodir a rota se alguém editar o banco na mão.
  try {
    return { configured: true, host: new URL(url).host, hasSecret };
  } catch {
    return { configured: true, host: null, hasSecret };
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  const row = readWebhookRow();
  return NextResponse.json(toPublicState(row.call_webhook_url, row.call_webhook_secret));
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { url: urlInput } = (body ?? {}) as { url?: unknown };
  // `url` ausente conta como corpo inválido, e não como "apagar": um PUT com
  // corpo vazio (ou com o campo escrito errado) zerar a configuração sem
  // reclamar seria fácil demais de fazer sem querer. Pra limpar, tem que
  // mandar `null` ou string vazia de propósito.
  if (urlInput !== null && typeof urlInput !== 'string') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const raw = typeof urlInput === 'string' ? urlInput.trim() : '';
  let toStore: string | null = null;
  if (raw) {
    // Validação SÓ sintática, de propósito: tem que parsear e tem que ser
    // https (o webhook leva um token; em http ele vaza no caminho).
    //
    // NÃO resolvemos DNS nem barramos IP privado/loopback/link-local aqui, e
    // isso não é esquecimento: entre gravar e disparar, o nome pode passar a
    // apontar pra outro IP (DNS rebinding), então uma checagem no save daria
    // uma garantia que ela não tem. Essa defesa é do lado do disparo, contra o
    // endereço realmente conectado — ver o item C3 do plano.
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
    }
    if (parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
    }
    toStore = raw;
  }

  const db = getDb();
  // Só a URL muda: trocar de destino não invalida o segredo, que é o par
  // compartilhado com o n8n. Quem quiser um segredo novo pede um explicitamente.
  db.prepare('UPDATE app_settings SET call_webhook_url = ? WHERE id = 1').run(toStore);

  return NextResponse.json(toPublicState(toStore, readWebhookRow().call_webhook_secret));
}
