// Cliente do Jellyfin, do lado do SERVIDOR (W3). Nunca importar disto num
// componente de cliente: o token e a senha moram aqui.
//
// POR QUE UM USUÁRIO DEDICADO ATRÁS DE PROXY NOSSO
// ------------------------------------------------
// O Jellyfin não tem token por-item nem link assinado: token de usuário e API
// key dão acesso amplo à biblioteca. Então o controle real é criar um usuário
// Jellyfin dedicado, com Library Access limitado à biblioteca que interessa, e
// o Next.js guardar essa credencial e fazer proxy do stream. O token nunca
// chega ao navegador de ninguém — nem ao de quem está na call.
//
// DIRECT PLAY É REQUISITO, NÃO OTIMIZAÇÃO
// ---------------------------------------
// O Jellyfin NÃO deduplica transcodes: o TranscodingJobHelper indexa jobs por
// PlaySessionId, então 5 clientes pedindo o mesmo arquivo geram 5 processos
// ffmpeg independentes. O device profile abaixo existe pra evitar isso —
// declara o que o navegador aguenta SEM limite de bitrate, porque um limite
// conservador é o gatilho nº 1 de transcode acidental.
//
// NADA DISTO FOI TESTADO CONTRA UM JELLYFIN DE VERDADE. Os dois primeiros
// testes do spike W0 (Direct Play funciona? Accept-Ranges: bytes funciona no
// endpoint de vídeo?) nunca foram feitos — só o terceiro (o COEP) foi. O plano
// pede o spike ANTES deste código; ele está aqui porque foi pedido, mas
// continua sendo hipótese até alguém rodar contra media.pedroserver.site.

const JELLYFIN_URL = process.env.JELLYFIN_URL?.replace(/\/$/, '') ?? '';
const JELLYFIN_USER = process.env.JELLYFIN_USER ?? '';
const JELLYFIN_PASSWORD = process.env.JELLYFIN_PASSWORD ?? '';

/** Identifica a app pro Jellyfin. Ele exige este header em toda chamada. */
const AUTH_HEADER =
  'MediaBrowser Client="Concord", Device="Concord", DeviceId="concord-server", Version="0.2.0"';

export function jellyfinConfigured(): boolean {
  return Boolean(JELLYFIN_URL && JELLYFIN_USER);
}

interface Session {
  token: string;
  userId: string;
}

/**
 * Uma sessão só, reaproveitada. Autenticar a cada request criaria uma sessão
 * nova no Jellyfin por clique — ele lista todas na tela de admin.
 */
let session: Session | null = null;
let pending: Promise<Session> | null = null;

async function authenticate(): Promise<Session> {
  const response = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: AUTH_HEADER,
    },
    body: JSON.stringify({ Username: JELLYFIN_USER, Pw: JELLYFIN_PASSWORD }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`jellyfin auth ${response.status}`);
  }
  const data = (await response.json()) as { AccessToken?: string; User?: { Id?: string } };
  if (!data.AccessToken || !data.User?.Id) {
    throw new Error('jellyfin auth sem token');
  }
  return { token: data.AccessToken, userId: data.User.Id };
}

async function getSession(): Promise<Session> {
  if (session) {
    return session;
  }
  // `pending` evita a corrida de N requests simultâneos autenticando juntos.
  pending ??= authenticate()
    .then((next) => {
      session = next;
      return next;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Invalida a sessão. Chamado quando o Jellyfin responde 401. */
export function forgetJellyfinSession(): void {
  session = null;
}

async function jellyfinFetch(path: string, init?: RequestInit): Promise<Response> {
  const current = await getSession();
  const call = (token: string) =>
    fetch(`${JELLYFIN_URL}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `${AUTH_HEADER}, Token="${token}"`,
      },
      cache: 'no-store',
    });

  let response = await call(current.token);
  if (response.status === 401) {
    // Token expirou ou foi revogado no Jellyfin. Uma segunda chance, e só uma.
    forgetJellyfinSession();
    const renewed = await getSession();
    response = await call(renewed.token);
  }
  return response;
}

export interface JellyfinItem {
  id: string;
  name: string;
  /** 'Movie', 'Episode', 'Series', 'Folder'... */
  type: string;
  year: number | null;
  /** Duração em ms, quando o Jellyfin souber. */
  durationMs: number | null;
}

interface RawItem {
  Id?: string;
  Name?: string;
  Type?: string;
  ProductionYear?: number;
  RunTimeTicks?: number;
}

/** Ticks do .NET: 100 nanossegundos. É como o Jellyfin conta duração. */
const TICKS_PER_MS = 10_000;

function toItem(raw: RawItem): JellyfinItem | null {
  if (!raw.Id || !raw.Name) {
    return null;
  }
  return {
    id: raw.Id,
    name: raw.Name,
    type: raw.Type ?? 'Unknown',
    year: raw.ProductionYear ?? null,
    durationMs: raw.RunTimeTicks ? Math.round(raw.RunTimeTicks / TICKS_PER_MS) : null,
  };
}

/**
 * Lista o que dá pra assistir. Sem `parentId` traz a raiz do que o usuário
 * dedicado enxerga — que já é a fatia da biblioteca que ele tem permissão de
 * ver, porque o recorte é feito no Jellyfin, não aqui.
 */
export async function listJellyfinItems(
  parentId?: string,
  search?: string,
): Promise<JellyfinItem[]> {
  const { userId } = await getSession();
  const params = new URLSearchParams({
    Recursive: search ? 'true' : 'false',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'ProductionYear',
    Limit: '200',
    IncludeItemTypes: 'Movie,Series,Season,Episode,Folder',
  });
  if (parentId) {
    params.set('ParentId', parentId);
  }
  if (search) {
    params.set('SearchTerm', search);
  }

  const response = await jellyfinFetch(`/Users/${userId}/Items?${params}`);
  if (!response.ok) {
    throw new Error(`jellyfin items ${response.status}`);
  }
  const data = (await response.json()) as { Items?: RawItem[] };
  return (data.Items ?? []).map(toItem).filter((item): item is JellyfinItem => item !== null);
}

/**
 * A URL de stream PROGRESSIVO do item, já com o token — só pra uso interno do
 * proxy, nunca devolvida ao navegador.
 *
 * Progressivo e não HLS de propósito: com Direct Play, o progressivo com Range
 * dá seek mais preciso, e HLS só é necessário quando há transcode. `static=true`
 * é o que pede o arquivo como está, sem remux.
 */
export async function jellyfinStreamUrl(itemId: string): Promise<string> {
  const current = await getSession();
  const params = new URLSearchParams({
    static: 'true',
    mediaSourceId: itemId,
    api_key: current.token,
  });
  return `${JELLYFIN_URL}/Videos/${itemId}/stream?${params}`;
}
