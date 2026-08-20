// Camada fina sobre as rotas de API da ONDA 1 (auth + canais).
// Contrato confirmado lendo app/api/auth/{me,logout}/route.ts e
// app/api/channels/{route,presence/route}.ts.

export interface CurrentUser {
  // Adicionado pela ONDA C — necessario pra montar a URL do proprio avatar
  // (GET /api/avatars/:id) sem outra chamada. Aditivo, ver app/api/auth/me.
  id: number;
  username: string;
  isAdmin: boolean;
  // Aditivo (correção do bug do F5 na foto de perfil) — já vem versionada
  // (?v=...), pronta pra usar direto num <img src>. Ver app/api/auth/me.
  avatarUrl: string | null;
}

/** 'voice' = canal com sala no LiveKit (como ja existia). 'text' = canal `#` com historico de mensagens (ONDA A). */
export type ChannelType = 'voice' | 'text';

export interface Channel {
  id: number;
  name: string;
  /** Slug do canal — tambem e o nome da sala no LiveKit quando type === 'voice' (usado em /rooms/[roomName]). */
  slug: string;
  position: number;
  type: ChannelType;
}

export interface PresenceParticipant {
  identity: string;
  name: string;
  /** Sem microfone publicado, ou publicado e mudo — pra quem olha a lista os
   * dois casos significam a mesma coisa. Ver /api/channels/presence. */
  muted: boolean;
  /** Camera ligada agora. */
  camera: boolean;
  /** Compartilhando tela agora (o badge LIVE da sidebar). */
  screenShare: boolean;
}

interface PresenceChannelEntry {
  id: number;
  slug: string;
  participants: PresenceParticipant[];
}

interface PresenceResponse {
  channels: PresenceChannelEntry[];
  /** Presente quando o SFU nao respondeu — participantes vem vazios, nao e erro. */
  degraded?: boolean;
}

/** Mapa slug do canal -> lista de participantes presentes agora. */
export type PresenceMap = Record<string, PresenceParticipant[]>;

/** Busca o usuario logado. Retorna null se nao houver sessao (401). */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Falha ao buscar usuario logado: ${res.status}`);
  }
  return (await res.json()) as CurrentUser;
}

export async function logout(): Promise<void> {
  const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(`Falha ao sair: ${res.status}`);
  }
}

export async function fetchChannels(): Promise<Channel[]> {
  const res = await fetch('/api/channels', { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(`Falha ao buscar canais: ${res.status}`);
  }
  return (await res.json()) as Channel[];
}

export async function fetchPresence(): Promise<PresenceMap> {
  const res = await fetch('/api/channels/presence', { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(`Falha ao buscar presenca: ${res.status}`);
  }
  const data = (await res.json()) as PresenceResponse;
  const map: PresenceMap = {};
  for (const entry of data.channels) {
    map[entry.slug] = entry.participants;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Chamadas de administração (ONDA 3) — usuarios e CRUD completo de canais.
// Contrato confirmado lendo app/api/users/{route,[id]/route}.ts e
// app/api/channels/{route,[id]/route,reorder/route}.ts.

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: number;
}

/** Erro de uma chamada à API admin, carregando o codigo cru (`error`) devolvido pelo servidor. */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = 'unknown_error';
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') code = body.error;
    } catch {
      // resposta sem corpo JSON (ex.: erro de rede) — mantem o codigo generico
    }
    throw new ApiError(code, res.status);
  }
  return (await res.json()) as T;
}

/** Traduz um erro de chamada admin numa mensagem legivel em pt-BR pra UI. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_body':
        return 'Dados inválidos. Confira os campos preenchidos.';
      case 'not_authenticated':
        return 'Sua sessão expirou. Faça login novamente.';
      case 'forbidden':
        return 'Você não tem permissão para executar essa ação.';
      case 'not_found':
        return 'Registro não encontrado — pode já ter sido removido por outra sessão.';
      case 'username_taken':
        return 'Já existe um usuário com esse nome.';
      case 'slug_taken':
        return 'Já existe um canal com esse identificador.';
      case 'last_admin':
        return 'Essa ação deixaria o sistema sem nenhum administrador. Promova outra pessoa antes.';
      case 'invalid_format':
        return 'Formato de imagem não reconhecido. Use JPEG, PNG, WEBP ou GIF.';
      case 'file_too_large':
        return 'Arquivo grande demais.';
      case 'upload_failed':
        return 'Não foi possível enviar o arquivo. Tente de novo.';
      case 'network_error':
        return 'Falha de rede ao enviar o arquivo.';
      case 'aborted':
        return 'Envio cancelado.';
      case 'attachment_not_found':
        return 'O arquivo enviado não foi encontrado no servidor. Envie de novo.';
      case 'unsupported_format':
        return 'Formato não suportado.';
      case 'wrong_password':
        return 'Senha atual incorreta.';
      case 'password_too_short':
        return 'A nova senha precisa ter pelo menos 8 caracteres.';
      case 'password_mismatch':
        return 'A confirmação não bate com a nova senha.';
      default:
        return `Erro inesperado (${err.code}).`;
    }
  }
  if (err instanceof Error) return err.message;
  return 'Erro inesperado. Tente de novo.';
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const res = await fetch('/api/users', { credentials: 'same-origin' });
  return parseJsonOrThrow<AdminUser[]>(res);
}

export async function createUser(input: {
  username: string;
  password: string;
  isAdmin?: boolean;
}): Promise<AdminUser> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<AdminUser>(res);
}

export async function updateUser(
  id: number,
  input: { password?: string; isAdmin?: boolean },
): Promise<AdminUser> {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<AdminUser>(res);
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'same-origin' });
  if (res.status === 204) return;
  await parseJsonOrThrow(res); // 204 nao tem corpo; qualquer outro status lanca com o codigo certo
}

export async function createChannel(input: {
  name: string;
  slug?: string;
  type?: ChannelType;
}): Promise<Channel> {
  const res = await fetch('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<Channel>(res);
}

export async function updateChannel(
  id: number,
  input: { name?: string; slug?: string; position?: number },
): Promise<Channel> {
  const res = await fetch(`/api/channels/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<Channel>(res);
}

export async function deleteChannel(id: number): Promise<void> {
  const res = await fetch(`/api/channels/${id}`, { method: 'DELETE', credentials: 'same-origin' });
  if (res.status === 204) return;
  await parseJsonOrThrow(res);
}

/** Reordena canais. `order` deve conter exatamente os ids de todos os canais existentes. */
export async function reorderChannels(order: number[]): Promise<Channel[]> {
  const res = await fetch('/api/channels/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ order }),
  });
  return parseJsonOrThrow<Channel[]>(res);
}

// ---------------------------------------------------------------------------
// Membros e avatar (ONDA C). Contrato confirmado lendo
// app/api/members/route.ts e app/api/avatars/{route,[id]/route}.ts.

export interface Member {
  id: number;
  username: string;
  /** URL pra GET /api/avatars/:id, ou null se a pessoa nao tem foto (usar avatar gerado). */
  avatarUrl: string | null;
}

/** Lista todo mundo cadastrado (nao so quem esta numa call agora). */
export async function fetchMembers(): Promise<Member[]> {
  const res = await fetch('/api/members', { credentials: 'same-origin' });
  return parseJsonOrThrow<Member[]>(res);
}

/** Envia a foto de perfil do proprio usuario logado. `file` deve vir de um <input type="file">. */
export async function uploadAvatar(file: File | Blob): Promise<{ avatarUrl: string }> {
  const formData = new FormData();
  formData.append('avatar', file);
  const res = await fetch('/api/avatars', {
    method: 'POST',
    credentials: 'same-origin',
    body: formData,
  });
  return parseJsonOrThrow<{ avatarUrl: string }>(res);
}

// ---------------------------------------------------------------------------
// Mensagens de canal de texto (ONDA A). Contrato confirmado lendo
// app/api/channels/[id]/messages/{route,[messageId]/route,stream/route}.ts.

export interface MessageAttachment {
  url: string;
  name: string;
  mime: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  size: number;
}

export interface ChannelMessage {
  id: number;
  channelId: number;
  authorId: number | null;
  /** "Usuario removido" quando o autor apagou a conta desde entao. */
  authorName: string;
  content: string;
  createdAt: number;
  attachment: MessageAttachment | null;
}

interface MessagesPage {
  messages: ChannelMessage[];
  /** Se true, existe historico mais antigo que essa pagina (pra "carregar mais"). */
  hasMore: boolean;
}

/**
 * Busca uma pagina de historico do canal. Sem `before`, traz a pagina mais
 * recente. Com `before`, traz as mensagens imediatamente anteriores aquele id
 * (rolar pra cima / "carregar mais").
 */
export async function fetchMessages(
  channelId: number,
  options?: { before?: number; limit?: number },
): Promise<MessagesPage> {
  const url = new URL(`/api/channels/${channelId}/messages`, window.location.origin);
  if (options?.before !== undefined) url.searchParams.set('before', String(options.before));
  if (options?.limit !== undefined) url.searchParams.set('limit', String(options.limit));
  const res = await fetch(url.toString(), { credentials: 'same-origin' });
  return parseJsonOrThrow<MessagesPage>(res);
}

/** Posta uma mensagem no canal. Autor vem sempre da sessao no servidor, nunca daqui. */
/** O que o POST de anexo devolve — o "recibo" que a mensagem vai referenciar. */
export interface UploadedAttachment {
  path: string;
  name: string;
  mime: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  size: number;
}

/**
 * Sobe um arquivo pro chat. Corpo BRUTO, nao FormData: o servidor grava em
 * stream direto no disco (ver lib/uploads.ts), e multipart obrigaria a
 * bufferizar tudo em memoria antes de validar.
 *
 * `onProgress` recebe 0..1. Usa XMLHttpRequest porque `fetch` ainda nao tem
 * progresso de UPLOAD em nenhum navegador — so de download.
 */
export function uploadAttachment(
  file: File,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedAttachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/attachments?name=${encodeURIComponent(file.name)}`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      const body = xhr.response as { error?: string } | UploadedAttachment | null;
      if (xhr.status >= 200 && xhr.status < 300 && body && !('error' in body)) {
        resolve(body as UploadedAttachment);
        return;
      }
      const code = (body as { error?: string } | null)?.error ?? 'upload_failed';
      reject(new ApiError(code, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('network_error', 0));
    xhr.onabort = () => reject(new ApiError('aborted', 0));
    options.signal?.addEventListener('abort', () => xhr.abort());

    xhr.send(file);
  });
}

export async function postMessage(
  channelId: number,
  content: string,
  attachment?: UploadedAttachment | null,
): Promise<ChannelMessage> {
  const res = await fetch(`/api/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ content, attachment: attachment ?? undefined }),
  });
  return parseJsonOrThrow<ChannelMessage>(res);
}

/** Apaga uma mensagem. O servidor recusa (403) se quem chama nao for o autor nem admin. */
export async function deleteMessage(channelId: number, messageId: number): Promise<void> {
  const res = await fetch(`/api/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (res.status === 204) return;
  await parseJsonOrThrow(res);
}

/** URL do endpoint SSE de um canal — quem usa monta o proprio `new EventSource(...)`. */
export function channelMessageStreamUrl(channelId: number): string {
  return `/api/channels/${channelId}/messages/stream`;
}

// ---------------------------------------------------------------------------
// Troca da propria senha (ONDA C). Contrato confirmado lendo
// app/api/auth/change-password/route.ts.

/** Troca a senha do proprio usuario logado. Exige a senha atual. */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  await parseJsonOrThrow(res);
}

// --- Soundboard (biblioteca compartilhada) ----------------------------------

export interface Sound {
  id: number;
  name: string;
  url: string;
  size: number;
  /** `null` se a conta de quem subiu foi apagada. O som continua sendo do grupo. */
  uploadedBy: number | null;
  createdAt: number;
  /** Corte de entrada, em segundos (0 = do começo). */
  trimStart: number;
  /** Corte de saída, em segundos; `null` = toca até o fim. */
  trimEnd: number | null;
}

export async function fetchSounds(): Promise<Sound[]> {
  const res = await fetch('/api/sounds', { credentials: 'same-origin' });
  return parseJsonOrThrow<Sound[]>(res);
}

/** Corpo bruto, igual ao anexo do chat — ver uploadAttachment. */
export async function uploadSound(file: File): Promise<Sound> {
  const res = await fetch(`/api/sounds?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    body: file,
  });
  return parseJsonOrThrow<Sound>(res);
}

/**
 * Edita nome e/ou corte de um som. Parcial: campo ausente fica como esta. O
 * corte nao reescreve o arquivo, so grava onde comecar e onde parar (ver PATCH
 * em app/api/sounds/[id]). Recusa (403) se quem chama nao subiu o som nem e
 * admin.
 */
export async function updateSound(
  id: number,
  patch: { name?: string; trimStart?: number; trimEnd?: number | null },
): Promise<Sound> {
  const res = await fetch(`/api/sounds/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow<Sound>(res);
}

/** O servidor recusa (403) se quem chama nao subiu o som nem e admin. */
export async function deleteSound(id: number): Promise<void> {
  const res = await fetch(`/api/sounds/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? 'unknown', res.status);
  }
}
