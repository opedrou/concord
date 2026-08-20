// Biblioteca de sons da soundboard.
//
// COMPARTILHADA, não por pessoa: o que alguém sobe fica disponível pra todo
// mundo tocar. É o requisito do roadmap, e é o que faz uma soundboard ter graça
// num grupo de amigos.
//
// Reusa a camada de upload dos anexos (lib/uploads.ts) com dois apertos: teto
// muito menor e só formatos de ÁUDIO aceitos.

import fs from 'node:fs';
import path from 'node:path';
import type { MediaFormat } from './uploads';
import type { DbSound } from './db';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
export const SOUNDS_DIR = process.env.SOUNDS_DIR ?? path.join(DATA_DIR, 'sounds');

// Os limites moram em lib/uploadLimits.ts (modulo sem node:fs), pra o cliente
// poder avisar antes de subir. Reexportados aqui pra quem ja importava daqui.
export { MAX_SOUND_BYTES, MAX_SOUND_NAME_LENGTH } from './uploadLimits';

export function ensureSoundsDir(): void {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

export function resolveSoundPath(filename: string): string {
  return path.join(SOUNDS_DIR, path.basename(filename));
}

/** Aceita só áudio — vídeo e imagem não têm o que fazer numa soundboard. */
export function isAcceptedSoundFormat(format: MediaFormat): boolean {
  return format.kind === 'audio';
}

export function soundUrlFor(id: number, filename: string): string {
  return `/api/sounds/${id}?v=${encodeURIComponent(filename)}`;
}

/** Formato do som exposto pela API (ver app/api/sounds). */
export interface PublicSound {
  id: number;
  name: string;
  url: string;
  size: number;
  /** `null` se a conta de quem subiu foi apagada. O som continua sendo do grupo. */
  uploadedBy: number | null;
  createdAt: number;
  /** Corte de entrada, em segundos. */
  trimStart: number;
  /** Corte de saída, em segundos; `null` = toca até o fim. */
  trimEnd: number | null;
}

export function toPublicSound(row: DbSound): PublicSound {
  return {
    id: row.id,
    name: row.name,
    url: soundUrlFor(row.id, row.filename),
    size: row.size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    trimStart: row.trim_start ?? 0,
    trimEnd: row.trim_end ?? null,
  };
}
