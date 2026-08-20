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
