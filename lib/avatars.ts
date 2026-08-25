// Armazenamento e validação de fotos de perfil (ONDA C).
//
// Onde guardar: arquivo em $DATA_DIR/avatars, não BLOB no SQLite. Motivo:
// o volume em /data já existe e é gravável pelo uid 1001 (ver Dockerfile);
// servir um arquivo estático por uma rota é mais simples e mais barato em
// memória do que puxar um BLOB pro processo Node a cada requisição de
// avatar — e a galeria de membros pode pedir vários avatares por vez.
// BLOB teria a vantagem de ficar no mesmo backup/arquivo que o resto do
// banco, mas pra 2-5 pessoas isso não paga o custo de I/O extra.
//
// Nome do arquivo salvo é sempre gerado aqui (randomUUID + extensão
// derivada do magic byte real) — nunca deriva de nome enviado pelo
// cliente, o que elimina path traversal por construção.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
export const AVATARS_DIR = process.env.AVATARS_DIR ?? path.join(DATA_DIR, 'avatars');

/** Limite firme de tamanho de upload — 5 MiB é generoso pra foto de perfil. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export type AvatarExt = 'jpg' | 'png' | 'webp' | 'gif';

interface AvatarFormat {
  ext: AvatarExt;
  contentType: string;
}

/**
 * Identifica o formato real do arquivo pelos magic bytes (assinatura no
 * início do conteúdo), ignorando completamente `Content-Type` do form e a
 * extensão do nome enviado pelo cliente — ambos são controlados por quem
 * envia a requisição e não provam nada sobre o conteúdo real do arquivo.
 * Retorna null se não reconhecer nenhum dos formatos aceitos.
 */
export function detectImageFormat(bytes: Uint8Array): AvatarFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { ext: 'gif', contentType: 'image/gif' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export function contentTypeForExt(ext: string): string {
  switch (ext) {
    case 'jpg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/** Garante que o diretório de avatares existe (idempotente). */
export function ensureAvatarsDir(): void {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

/** Grava os bytes validados com um nome gerado pelo servidor. Retorna o nome do arquivo salvo. */
export function saveAvatarFile(bytes: Uint8Array, ext: AvatarExt): string {
  ensureAvatarsDir();
  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(AVATARS_DIR, filename), bytes);
  return filename;
}

/** Remove um avatar antigo do disco, se existir. Nunca lança — best-effort. */
export function deleteAvatarFileIfExists(filename: string | null | undefined): void {
  if (!filename) return;
  try {
    // path.basename evita qualquer tentativa de sair de AVATARS_DIR mesmo
    // que o valor no banco algum dia venha corrompido/manipulado.
    fs.unlinkSync(path.join(AVATARS_DIR, path.basename(filename)));
  } catch {
    // Arquivo já não existe ou não pôde ser removido — não é fatal.
  }
}

/** Resolve o caminho absoluto de um avatar salvo, sem permitir path traversal. */
export function resolveAvatarPath(filename: string): string {
  return path.join(AVATARS_DIR, path.basename(filename));
}

/**
 * Monta a URL pública do avatar já com cache-busting embutido.
 *
 * Bug corrigido aqui: a URL de GET /api/avatars/:id era estável (derivada só
 * do id do usuário), então o navegador continuava servindo a foto antiga do
 * cache HTTP depois de uma troca — só um F5 força revalidação porque reload
 * manda `Cache-Control: max-age=0` na requisição, ignorando o cache normal.
 * Em vez de desligar o cache (o que bateria no servidor a cada tile
 * renderizado numa call), a URL agora carrega `?v=<nome do arquivo>` como
 * query string: `avatar_path` já é um `randomUUID()` novo a cada upload (ver
 * `saveAvatarFile`), então ele já é, por construção, um token de versão
 * único — não precisou de coluna nova no banco. Como a URL muda sempre que o
 * conteúdo muda, dá pra cachear a resposta de forma agressiva e imutável do
 * lado do cliente sem risco de mostrar foto desatualizada.
 */
export function avatarUrlFor(userId: number, avatarPath: string | null): string | null {
  if (!avatarPath) return null;
  return `/api/avatars/${userId}?v=${encodeURIComponent(avatarPath)}`;
}

/**
 * Valida a cor dominante que o CLIENTE calculou (ver lib/dominantColor.ts).
 * É entrada de usuário como qualquer outra: só passa `#rrggbb`, e devolve
 * sempre em minúsculo. Qualquer outra coisa — `red`, `rgb(...)`, `#abc`,
 * `#fff onmouseover=...` — vira null, e a coluna fica vazia (o tile cai no
 * `--accent`). Assim o valor que sai do banco pro `style` do tile nunca é
 * texto arbitrário de quem enviou a foto.
 */
export function normalizeAvatarColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
}
