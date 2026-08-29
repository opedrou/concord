// "Chamar pessoas": dispara UM POST assinado no webhook configurado (o n8n do
// admin, que de lá manda a notificação) avisando que fulano chamou beltrano
// para um canal. Qualquer pessoa logada pode chamar.
//
// POST /api/call-people   (sessão)
//   Body: { userIds: number[], channelSlug: string }
//     userIds     — de 1 a MAX_CALLED ids inteiros, sem repetição. SÓ IDS: os
//                   `username` que vão no payload são resolvidos aqui, contra o
//                   banco. Aceitar nome do cliente deixaria qualquer um mandar
//                   uma notificação dizendo o que quisesse.
//     channelSlug — slug de um canal existente.
//   200: { ok: true, called: number }
//   400: { error: 'invalid_body' | 'unknown_user' | 'unknown_channel' }
//   401: sem sessão
//   409: { error: 'not_configured' | 'no_secret' }  — nada foi disparado
//   429: { error: 'rate_limited' } + Retry-After
//
// A resposta é grossa de propósito: nada do que o webhook respondeu (corpo,
// headers, status) chega ao cliente. app/api/record/start/route.ts devolve o
// `error.message` do SDK direto no corpo e é o exemplo do que NÃO fazer —
// vazar a resposta desfaria a checagem de SSRF do lib/webhook.ts (bloquear a
// conexão para 10.0.0.5 não adianta se dá pra ler o que 10.0.0.5 respondeu).
//
// As defesas do disparo em si (https obrigatório, DNS resolvido com recusa de
// IP privado/loopback/link-local, nenhum redirect seguido, timeout curto)
// moram inteiras em lib/webhook.ts#deliverWebhook e não são reimplementadas
// aqui — esta rota e a de teste (app/api/settings/webhook/test) são os dois
// chamadores.
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';
import { DbAppSettings, getDb } from '@/lib/db';
import { RateLimit, recordFailure, retryAfterSeconds } from '@/lib/rateLimit';
import { deliverWebhook } from '@/lib/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Teto de gente por chamada. O grupo é pequeno; isto é anti-abuso, não regra de produto. */
const MAX_CALLED = 10;

/**
 * 6 chamadas por hora, por usuário — número escolhido pelo Pedro.
 *
 * Atenção ao que se conta aqui: no login o `recordFailure` marca uma FALHA de
 * senha; aqui marca um SUCESSO. É o oposto do uso original do módulo, e é o
 * certo para este caso: o que se quer limitar é quantas notificações uma
 * pessoa dispara, não quantas vezes ela erra o pedido.
 */
const CALL_LIMIT: RateLimit = { maxAttempts: 6, windowMs: 60 * 60 * 1000 };

/**
 * Base pública da app, para montar o link do canal que vai na notificação.
 *
 * `PUBLIC_BASE_URL` (opcional) tem prioridade. Sem ela, deriva do request:
 * `x-forwarded-proto` + `x-forwarded-host` (a app fica atrás do Cloudflare
 * Tunnel), caindo pro `Host` quando não há proxy.
 *
 * O `Host` é, em tese, controlável por quem faz a requisição — então um
 * usuário logado consegue fazer o link sair errado. O risco aqui é baixo e
 * aceito: o pior caso é um link torto DENTRO de uma notificação que vai pro
 * webhook do próprio admin. Não é escalada de privilégio, e não é SSRF: o
 * DESTINO do POST continua vindo do banco (`app_settings.call_webhook_url`),
 * nunca do request — este valor é só um campo de texto do corpo. Quem quiser
 * fechar mesmo assim, é só definir a env.
 */
function publicBaseUrl(request: NextRequest): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host') ||
    '';
  return `${proto}://${host}`;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { userIds, channelSlug } = (body ?? {}) as { userIds?: unknown; channelSlug?: unknown };
  if (
    !Array.isArray(userIds) ||
    userIds.length === 0 ||
    userIds.length > MAX_CALLED ||
    !userIds.every((id) => Number.isInteger(id)) ||
    new Set(userIds).size !== userIds.length ||
    typeof channelSlug !== 'string' ||
    !channelSlug
  ) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  // Descarta o proprio chamador, se ele veio na lista. A UI ja nao oferece
  // voce mesmo na selecao (ver o modal do C2), mas isso aqui e a defesa que
  // vale: quem chama a rota na mao nao passa pela UI. Sem o filtro, "chamar
  // todo mundo" faria o seu proprio celular tocar por causa do seu clique.
  // Sobrar lista vazia (voce pediu so a si mesmo) e corpo invalido.
  const ids = (userIds as number[]).filter((id) => id !== auth.user.id);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Rate limit ANTES de qualquer consulta e, principalmente, antes do disparo.
  const rateKey = `call:${auth.user.id}`;
  const retryAfter = retryAfterSeconds(rateKey, Date.now(), CALL_LIMIT);
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const db = getDb();

  // Os nomes saem daqui, não do cliente. Se algum id não existe, a contagem
  // não bate e nada é disparado.
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
    .all(...ids) as unknown as Array<{ id: number; username: string }>;
  if (rows.length !== ids.length) {
    return NextResponse.json({ error: 'unknown_user' }, { status: 400 });
  }
  const usernameById = new Map(rows.map((r) => [r.id, r.username]));
  // Na ordem em que o cliente pediu — só os nomes é que vêm do banco.
  const called = ids.map((id) => usernameById.get(id) as string);

  const channel = db.prepare('SELECT slug FROM channels WHERE slug = ?').get(channelSlug) as
    | { slug: string }
    | undefined;
  if (!channel) {
    return NextResponse.json({ error: 'unknown_channel' }, { status: 400 });
  }

  const settings = db
    .prepare('SELECT call_webhook_url, call_webhook_secret FROM app_settings WHERE id = 1')
    .get() as unknown as
    | Pick<DbAppSettings, 'call_webhook_url' | 'call_webhook_secret'>
    | undefined;
  const url = settings?.call_webhook_url ?? null;
  const secret = settings?.call_webhook_secret ?? null;
  if (!url) {
    return NextResponse.json({ error: 'not_configured' }, { status: 409 });
  }
  if (!secret) {
    // Sem segredo não dá pra assinar, e mandar um POST sem assinatura ensinaria
    // o n8n a aceitar requisição não autenticada. Melhor não disparar.
    return NextResponse.json({ error: 'no_secret' }, { status: 409 });
  }

  // MESMO formato do payload de teste (app/api/settings/webhook/test), com
  // `test: false`: o campo está sempre presente, então o fluxo do n8n filtra
  // teste de chamada de verdade num lugar só.
  const payload = {
    test: false,
    caller: auth.user.username,
    called,
    channel: channel.slug,
    channelUrl: `${publicBaseUrl(request)}/rooms/${encodeURIComponent(channel.slug)}`,
    at: new Date().toISOString(),
  };

  recordFailure(rateKey, Date.now(), CALL_LIMIT);

  // Dispara e NÃO espera. Quem clicou em "chamar" não pode ficar travado
  // porque o n8n caiu ou está lento — o resultado do POST não muda nada do
  // lado de cá, e o `deliverWebhook` já tem timeout próprio. O `catch` existe
  // só pra uma falha nunca virar `unhandledRejection` e derrubar o processo:
  // loga e segue.
  void deliverWebhook(url, secret, payload)
    .then((result) => {
      if (!result.ok) {
        console.warn('[call-people] webhook não aceitou', {
          status: result.status,
          error: result.error,
        });
      }
    })
    .catch((err) => {
      console.warn('[call-people] webhook lançou', err);
    });

  return NextResponse.json({ ok: true, called: called.length });
}
