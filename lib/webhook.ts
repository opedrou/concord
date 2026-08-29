/**
 * Disparo do webhook de chamada: assinatura HMAC + defesa contra SSRF.
 *
 * ─── O que é a assinatura e por que ela existe ──────────────────────────────
 *
 * O webhook é uma URL pública. Qualquer um que descubra o endereço consegue
 * fazer um POST nele. A assinatura é o que deixa o receptor (o n8n do Pedro)
 * responder à pergunta "esse POST veio mesmo do Concord?".
 *
 * HMAC-SHA256 é um hash com chave: `HMAC(segredo, mensagem)` produz 32 bytes
 * que só quem conhece o `segredo` consegue reproduzir. Isso dá duas coisas ao
 * mesmo tempo:
 *   - INTEGRIDADE: mudou um byte do corpo, o hash muda inteiro — dá pra saber
 *     que a mensagem foi adulterada no caminho.
 *   - AUTENTICIDADE: como o hash depende do segredo, quem produziu o hash certo
 *     tem o segredo; ou seja, é o Concord (ou alguém que roubou o segredo).
 *
 * O que HMAC **não** dá: sigilo. Isto NÃO é criptografia. O corpo do POST vai
 * em claro — quem intercepta o tráfego lê o JSON inteiro, nome do canal, tudo.
 * O que ele não consegue é *forjar* um POST novo nem alterar este sem que o
 * hash deixe de bater. O sigilo, aqui, quem dá é o `https:` obrigatório (TLS).
 *
 * Do lado do receptor, a comparação do hash recebido com o hash recalculado
 * tem que ser em TEMPO CONSTANTE (`crypto.timingSafeEqual` no Node,
 * `hmac.compare_digest` no Python). Um `===` comum para na primeira letra
 * diferente, então o tempo de resposta vaza quantos caracteres do início já
 * estavam certos — com muitas tentativas dá pra descobrir a assinatura correta
 * byte a byte, sem nunca ter tido o segredo. Comparação de tempo constante
 * sempre percorre os dois valores inteiros e não vaza nada.
 *
 * ─── Formato (o mesmo do Stripe e do GitHub) ───────────────────────────────
 *
 *   X-Concord-Timestamp: 1756400000
 *   X-Concord-Signature: sha256=<hex de 64 chars>
 *
 *   assinatura = HMAC_SHA256(segredo, `${timestamp}.${corpoExatoEnviado}`)
 *
 * Dois detalhes que, se errados, fazem a conferência falhar do outro lado:
 *
 * 1. Assinamos EXATAMENTE os bytes que vão no corpo. O `JSON.stringify` roda
 *    UMA vez, o resultado é assinado e é esse mesmo string que vai no `body`
 *    do fetch. Serializar duas vezes (uma pra assinar, outra pra mandar) daria
 *    o mesmo texto hoje, mas é errado por princípio: o receptor não tem o
 *    objeto, ele tem os bytes crus que chegaram, e é sobre eles que ele
 *    recalcula o HMAC. Qualquer diferença de espaço, ordem de chave ou escape
 *    entre "o que assinei" e "o que enviei" quebra tudo. Por isso o receptor
 *    também tem que ler o corpo CRU antes de dar `JSON.parse` — reserializar o
 *    objeto parseado quase nunca devolve os mesmos bytes.
 *
 * 2. O timestamp entra DENTRO da mensagem assinada, não só num header. Se ele
 *    ficasse só no header, alguém poderia mudá-lo à vontade — ele não está
 *    protegido pelo hash. E se não existisse, um POST válido capturado uma vez
 *    seria reutilizável para sempre (ataque de replay): reenviar os mesmos
 *    bytes com a mesma assinatura continuaria conferindo. Com o timestamp
 *    dentro do hash, o receptor faz duas checagens: a assinatura bate E o
 *    timestamp está dentro de uma janela curta (5 minutos, digamos). Um POST
 *    velho reenviado passa na primeira e falha na segunda.
 *
 *    O separador `.` existe pra não haver ambiguidade na concatenação: sem ele,
 *    timestamp `1` + corpo `23{...}` e timestamp `12` + corpo `3{...}` gerariam
 *    a mesma mensagem assinada.
 *
 * Como conferir do outro lado (pseudo-Node):
 *
 *   const esperado = 'sha256=' + createHmac('sha256', SEGREDO)
 *     .update(`${headers['x-concord-timestamp']}.${corpoCru}`).digest('hex');
 *   timingSafeEqual(Buffer.from(esperado), Buffer.from(headers['x-concord-signature']));
 *
 * ─── Por que a validação de SSRF mora aqui ─────────────────────────────────
 *
 * A URL é digitada por um admin e este servidor roda DENTRO da rede de casa.
 * Sem checagem, o botão vira um proxy pra alcançar o roteador, o NAS, o próprio
 * localhost — e, numa VPS, o endpoint de metadados da cloud (169.254.169.254),
 * que costuma entregar credenciais. Por isso resolvemos o DNS antes e recusamos
 * qualquer endereço que não seja público.
 *
 * Módulo separado do `route.ts` porque o item C3 (POST /api/call-people, o botão
 * de chamar de verdade) dispara exatamente o mesmo POST assinado, para a mesma
 * URL, com as mesmas defesas — dois chamadores reais, não abstração
 * antecipada.
 */
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Timeout do POST de saída. Curto de propósito: o admin está olhando pra tela
 * esperando o resultado, e um webhook que demora mais que isso pra dar ACK não
 * é um webhook, é um job.
 */
export const WEBHOOK_TIMEOUT_MS = 4000;

/**
 * 32 bytes de `crypto.randomBytes` em hex (64 caracteres). `randomBytes` é o
 * CSPRNG do sistema; `Math.random()` é previsível a partir de algumas amostras
 * e não serve pra nada que precise ser inadivinhável. 256 bits é o tamanho do
 * bloco do SHA-256 — nem sobra nem falta entropia.
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface SignedWebhookRequest {
  /** O corpo EXATO que vai no fetch — é sobre esta string que o HMAC foi feito. */
  body: string;
  headers: Record<string, string>;
}

/**
 * Serializa o payload UMA vez e assina essa string. Ver o item 1 do bloco no
 * topo: o `body` devolvido aqui tem que ir no fetch sem passar por nenhuma
 * outra serialização.
 */
export function signWebhookPayload(
  secret: string,
  payload: unknown,
  nowMs: number = Date.now(),
): SignedWebhookRequest {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(nowMs / 1000).toString();
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Concord-Timestamp': timestamp,
      'X-Concord-Signature': `sha256=${signature}`,
    },
  };
}

/**
 * `true` = endereço que NÃO pode ser alvo do webhook. Lista de bloqueio por
 * faixa, cobrindo IPv4 e IPv6. Qualquer coisa que não seja um IP reconhecível
 * também volta `true`: na dúvida, recusa.
 */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 — "esta rede", inclui o unspecified
  if (a === 10) return true; // 10/8 — privado (RFC 1918)
  if (a === 127) return true; // 127/8 — loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 — CGNAT
  if (a === 169 && b === 254) return true; // 169.254/16 — link-local; aqui mora o 169.254.169.254 das clouds
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 — privado
  if (a === 192 && b === 168) return true; // 192.168/16 — privado
  if (a >= 224) return true; // 224/4 multicast e 240/4 reservado (inclui 255.255.255.255)
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return true;

  // IPv4-mapped (::ffff:0:0/96). É o furo clássico: `::ffff:10.0.0.1` é o
  // 10.0.0.1 de sempre, escrito em IPv6, e passa batido por qualquer checagem
  // que só olhe strings de IPv4. Delegamos pro classificador v4.
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) {
    if (groups[4] === 0 && groups[5] === 0xffff) {
      const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
      return isBlockedIpv4(v4);
    }
    // ::, ::1 e os IPv4-compatible (::a.b.c.d, obsoletos): tudo que começa com
    // 96 bits zerados é unspecified, loopback ou legado — nada disso é destino
    // legítimo de webhook.
    if (groups[4] === 0 && groups[5] === 0) return true;
  }

  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 — unique-local (o "privado" do IPv6)
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 — multicast
  return false;
}

/** Endereço IPv6 textual -> 8 grupos de 16 bits, ou null se não parsear. */
function parseIpv6(address: string): number[] | null {
  // Zona de escopo (`fe80::1%eth0`) não interessa pra classificação.
  let text = address.split('%')[0].toLowerCase();

  // Forma mista (`::ffff:10.0.0.1`): converte a cauda decimal em dois grupos
  // hex, para o resto do parser lidar com um formato só.
  const lastColon = text.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = tail.split('.').map((s) => Number(s));
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  // O `::` abrevia uma sequência de grupos zerados e pode aparecer no máximo
  // uma vez; a expansão é preencher o buraco até fechar 8 grupos.
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups =
    right === null
      ? left
      : [...left, ...new Array(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8) return null;

  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

/**
 * Resultado grosso, de propósito. O corpo e os headers que o webhook devolve
 * NUNCA saem daqui: o admin pediu "dispara pra essa URL", e devolver a resposta
 * dela transformaria a rota num leitor de qualquer endpoint alcançável pelo
 * servidor — que é justamente o que a checagem de SSRF acima está evitando.
 * `status` é o único detalhe que passa, porque é o que responde "o n8n aceitou?".
 */
export type WebhookDeliveryResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; error?: 'timeout' | 'blocked' | 'redirect' | 'network' };

/**
 * Faz o POST assinado. Nunca lança: todo caminho de erro vira um
 * `WebhookDeliveryResult`.
 *
 * TOCTOU conhecido e aceito: resolvemos o DNS, aprovamos os IPs e só então
 * chamamos o `fetch`, que resolve o nome DE NOVO por conta própria. Entre uma
 * coisa e outra o registro pode ter mudado para um IP interno (DNS rebinding),
 * e a conexão real escaparia da checagem. Fechar essa janela exigiria um agente
 * HTTP customizado que conecta no IP já validado e reescreve o SNI/Host —
 * complexidade desproporcional para uma URL que só um admin consegue gravar,
 * numa rede doméstica, sem entrada anônima em lugar nenhum. Aceitamos.
 */
export async function deliverWebhook(
  rawUrl: string,
  secret: string,
  payload: unknown,
): Promise<WebhookDeliveryResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'blocked' };
  }
  // https obrigatório: o corpo vai em claro (HMAC não criptografa) e a URL
  // costuma ter token no query string.
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'blocked' };
  }

  // `all: true` porque um nome pode ter vários registros; basta UM deles ser
  // interno para o destino ser recusado — deixar passar "só se o primeiro for
  // público" seria uma loteria que o atacante controla.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    // Não resolveu: não é uma recusa de segurança, é um destino que não existe.
    return { ok: false, error: 'network' };
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    return { ok: false, error: 'blocked' };
  }

  const signed = signWebhookPayload(secret, payload);

  // Timeout explícito: sem isso, um destino que aceita a conexão e nunca
  // responde segura o handler pelo tempo que quiser.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
      // `redirect: 'manual'` e nenhum redirect é seguido. Um 302 apontando pra
      // http://169.254.169.254/ furaria toda a validação de DNS acima, porque
      // o segundo salto não passa por ela. Redirect aqui é falha, e o admin
      // fica sabendo que foi isso.
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { ok: false, status: res.status || undefined, error: 'redirect' };
    }
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'timeout' };
    }
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
