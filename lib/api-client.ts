// Camada fina sobre as rotas de API da ONDA 1 (auth + canais).
// Contrato confirmado lendo app/api/auth/{me,logout}/route.ts e
// app/api/channels/{route,presence/route}.ts.

export interface CurrentUser {
  username: string;
  isAdmin: boolean;
}

export interface Channel {
  id: number;
  name: string;
  /** Slug do canal — tambem e o nome da sala no LiveKit (usado em /rooms/[roomName]). */
  slug: string;
  position: number;
}

export interface PresenceParticipant {
  identity: string;
  name: string;
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

export async function createChannel(input: { name: string; slug?: string }): Promise<Channel> {
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
