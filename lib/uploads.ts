// Camada de upload compartilhada pelos anexos do chat e pela soundboard.
//
// Generaliza o que `lib/avatars.ts` já fazia bem — validar por magic bytes e
// nunca confiar em nome nem em Content-Type do cliente — e acrescenta o que os
// arquivos grandes exigem: gravação em STREAM, direto no disco.
//
// POR QUE STREAM E NÃO O MESMO CAMINHO DOS AVATARES
// -------------------------------------------------
// A rota de avatar lê o corpo inteiro pra memória antes de validar. Com 5 MiB
// isso é irrelevante; com um anexo de 95 MiB seria um array de 95 MB dentro do
// processo Node por upload simultâneo — num container pequeno, isso derruba a
// app inteira (e a chamada de voz de todo mundo junto). Aqui os bytes vão
// direto pro disco, e só os primeiros 64 ficam em memória, pro magic byte.
//
// Consequência: o corpo é BRUTO, não `multipart/form-data`. Parsear multipart
// em stream exigiria um parser próprio (ou uma dependência nova) e não traria
// nada — o nome do arquivo cabe na query string e é validado aqui do mesmo
// jeito.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

export interface MediaFormat {
  ext: string;
  contentType: string;
  kind: MediaKind;
}

/** Quantos bytes do começo bastam pra reconhecer todos os formatos abaixo. */
export const MAGIC_BYTES_NEEDED = 64;

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  return matches(
    bytes,
    offset,
    Array.from(text, (c) => c.charCodeAt(0)),
  );
}

/**
 * Identifica o formato real pelos magic bytes, ignorando completamente o
 * `Content-Type` e a extensão do nome enviado — os dois são controlados por
 * quem faz a requisição e não provam nada sobre o conteúdo.
 *
 * Formato desconhecido NÃO é erro: vira `kind: 'file'`, servido como download
 * genérico. "Enviar arquivos" no chat quer dizer qualquer arquivo.
 */
export function detectMediaFormat(bytes: Uint8Array): MediaFormat {
  // --- Imagem ---
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) {
    return { ext: 'jpg', contentType: 'image/jpeg', kind: 'image' };
  }
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: 'png', contentType: 'image/png', kind: 'image' };
  }
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) {
    return { ext: 'gif', contentType: 'image/gif', kind: 'image' };
  }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    return { ext: 'webp', contentType: 'image/webp', kind: 'image' };
  }

  // --- Vídeo ---
  // MP4 e família: caixa `ftyp` no offset 4. O subtipo logo depois distingue
  // mp4/mov/m4a, mas todos servem com o mesmo content-type de vídeo, exceto
  // M4A, que é áudio.
  if (ascii(bytes, 4, 'ftyp')) {
    if (ascii(bytes, 8, 'M4A ')) {
      return { ext: 'm4a', contentType: 'audio/mp4', kind: 'audio' };
    }
    if (ascii(bytes, 8, 'qt  ')) {
      return { ext: 'mov', contentType: 'video/quicktime', kind: 'video' };
    }
    return { ext: 'mp4', contentType: 'video/mp4', kind: 'video' };
  }
  // Matroska/WebM: o mesmo contêiner EBML serve pros dois. `video/webm` toca
  // em <video>, e um webm só de áudio também toca ali — então não vale a pena
  // desmontar o EBML pra descobrir se tem faixa de vídeo.
  if (matches(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { ext: 'webm', contentType: 'video/webm', kind: 'video' };
  }

  // --- Áudio ---
  if (
    ascii(bytes, 0, 'ID3') ||
    matches(bytes, 0, [0xff, 0xfb]) ||
    matches(bytes, 0, [0xff, 0xf3])
  ) {
    return { ext: 'mp3', contentType: 'audio/mpeg', kind: 'audio' };
  }
  if (ascii(bytes, 0, 'OggS')) {
    return { ext: 'ogg', contentType: 'audio/ogg', kind: 'audio' };
  }
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) {
    return { ext: 'wav', contentType: 'audio/wav', kind: 'audio' };
  }
  if (ascii(bytes, 0, 'fLaC')) {
    return { ext: 'flac', contentType: 'audio/flac', kind: 'audio' };
  }

  // --- Outros reconhecidos, mas servidos como download ---
  if (ascii(bytes, 0, '%PDF')) {
    return { ext: 'pdf', contentType: 'application/pdf', kind: 'file' };
  }
  if (matches(bytes, 0, [0x50, 0x4b, 0x03, 0x04])) {
    return { ext: 'zip', contentType: 'application/zip', kind: 'file' };
  }

  // NOTA DE SEGURANÇA: SVG não está aqui e não deve entrar. SVG é XML com
  // <script> permitido — servir um inline com `image/svg+xml` na nossa origem
  // é XSS de graça. Se algum dia precisar, tem que ir como download forçado.
  return { ext: 'bin', contentType: 'application/octet-stream', kind: 'file' };
}

/** Só imagem/vídeo/áudio abrem inline; o resto vai como download. */
export function dispositionFor(kind: MediaKind): 'inline' | 'attachment' {
  return kind === 'file' ? 'attachment' : 'inline';
}

export class UploadTooLargeError extends Error {
  constructor() {
    super('upload excedeu o limite');
    this.name = 'UploadTooLargeError';
  }
}

export class EmptyUploadError extends Error {
  constructor() {
    super('upload vazio');
    this.name = 'EmptyUploadError';
  }
}

export interface SavedUpload {
  /** Nome do arquivo no disco — sempre gerado aqui, nunca vindo do cliente. */
  filename: string;
  size: number;
  format: MediaFormat;
}

/**
 * Grava o corpo da requisição direto num arquivo, abortando assim que passar
 * do limite. Se algo der errado no meio, o arquivo parcial é removido — nunca
 * fica lixo de upload interrompido.
 *
 * O nome final só é conhecido depois de ler os primeiros bytes (a extensão vem
 * do formato REAL), então gravamos num nome temporário e renomeamos no fim.
 */
export async function saveUploadStream(
  body: ReadableStream<Uint8Array>,
  targetDir: string,
  maxBytes: number,
): Promise<SavedUpload> {
  fs.mkdirSync(targetDir, { recursive: true });

  const tempPath = path.join(targetDir, `.tmp-${randomUUID()}`);
  const handle = fs.createWriteStream(tempPath);
  const header = new Uint8Array(MAGIC_BYTES_NEEDED);
  let headerFilled = 0;
  let size = 0;

  const cleanupTemp = () => {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Já removido, ou nunca chegou a existir.
    }
  };

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new UploadTooLargeError();
      }

      if (headerFilled < MAGIC_BYTES_NEEDED) {
        const take = Math.min(MAGIC_BYTES_NEEDED - headerFilled, value.byteLength);
        header.set(value.subarray(0, take), headerFilled);
        headerFilled += take;
      }

      // `write` devolve false quando o buffer interno encheu; esperar o
      // 'drain' é o que impede um upload grande de inchar a memória mesmo
      // gravando em disco.
      if (!handle.write(value)) {
        await new Promise<void>((resolve, reject) => {
          handle.once('drain', resolve);
          handle.once('error', reject);
        });
      }
    }

    if (size === 0) {
      throw new EmptyUploadError();
    }

    await new Promise<void>((resolve, reject) => {
      handle.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });

    const format = detectMediaFormat(header.subarray(0, headerFilled));
    const filename = `${randomUUID()}.${format.ext}`;
    fs.renameSync(tempPath, path.join(targetDir, filename));
    return { filename, size, format };
  } catch (error) {
    handle.destroy();
    cleanupTemp();
    throw error;
  }
}

/** Nome ORIGINAL, só pra exibir e pro download. Nunca toca o disco. */
export function sanitizeDisplayName(raw: string | null, fallbackExt: string): string {
  // Tira caracteres de controle (que quebrariam o header Content-Disposition)
  // e aspas/barras invertidas, deixando acento e espaco em paz — e nome pra
  // ler, nao pra gravar em disco.
  // eslint-disable-next-line no-control-regex
  const base = (raw ?? '').replace(/[\u0000-\u001f\u007f"\\]/g, '').trim();
  // `path.basename` mata qualquer tentativa de "../"; o corte de tamanho evita
  // um nome de 4 KB entrando no banco e na tela.
  const cleaned = path.basename(base).slice(0, 120);
  return cleaned || `arquivo.${fallbackExt}`;
}

/** Remove um arquivo do diretório dado. Best-effort, nunca lança. */
export function deleteUploadIfExists(dir: string, filename: string | null | undefined): void {
  if (!filename) return;
  try {
    // `path.basename` protege mesmo se o valor no banco vier corrompido.
    fs.unlinkSync(path.join(dir, path.basename(filename)));
  } catch {
    // Já não existe — nada a fazer.
  }
}

/** Content-type derivado da extensão que NÓS gravamos (não do cliente). */
export function formatFromExt(ext: string): MediaFormat {
  const table: Record<string, MediaFormat> = {
    jpg: { ext: 'jpg', contentType: 'image/jpeg', kind: 'image' },
    png: { ext: 'png', contentType: 'image/png', kind: 'image' },
    gif: { ext: 'gif', contentType: 'image/gif', kind: 'image' },
    webp: { ext: 'webp', contentType: 'image/webp', kind: 'image' },
    mp4: { ext: 'mp4', contentType: 'video/mp4', kind: 'video' },
    mov: { ext: 'mov', contentType: 'video/quicktime', kind: 'video' },
    webm: { ext: 'webm', contentType: 'video/webm', kind: 'video' },
    mp3: { ext: 'mp3', contentType: 'audio/mpeg', kind: 'audio' },
    m4a: { ext: 'm4a', contentType: 'audio/mp4', kind: 'audio' },
    ogg: { ext: 'ogg', contentType: 'audio/ogg', kind: 'audio' },
    wav: { ext: 'wav', contentType: 'audio/wav', kind: 'audio' },
    flac: { ext: 'flac', contentType: 'audio/flac', kind: 'audio' },
    pdf: { ext: 'pdf', contentType: 'application/pdf', kind: 'file' },
    zip: { ext: 'zip', contentType: 'application/zip', kind: 'file' },
  };
  return table[ext] ?? { ext: 'bin', contentType: 'application/octet-stream', kind: 'file' };
}
