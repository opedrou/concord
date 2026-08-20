// Anexos do chat: onde ficam, quanto podem pesar e como se limpa o que sobra.
//
// Mesmo critério dos avatares (ver lib/avatars.ts): arquivo em disco no volume
// persistente, não BLOB no SQLite. Aqui o argumento é ainda mais forte — um
// vídeo de dezenas de MB passando pelo processo Node a cada exibição seria
// desperdício puro, e o `sendFile` do sistema operacional faz isso melhor.

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
export const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR ?? path.join(DATA_DIR, 'attachments');

// O limite mora em lib/uploadLimits.ts (modulo sem node:fs), pra o cliente
// poder avisar antes de subir. Reexportado aqui pra quem ja importava daqui.
export { MAX_ATTACHMENT_BYTES } from './uploadLimits';

export function ensureAttachmentsDir(): void {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

export function resolveAttachmentPath(filename: string): string {
  // `path.basename` protege mesmo se o valor no banco vier corrompido.
  return path.join(ATTACHMENTS_DIR, path.basename(filename));
}

/**
 * URL versionada por construção: o nome do arquivo é um UUID, então a URL de
 * um anexo nunca muda de conteúdo — dá pra cachear pra sempre. Mesmo truque do
 * `avatarUrlFor`.
 */
export function attachmentUrlFor(messageId: number, filename: string): string {
  return `/api/attachments/${messageId}?v=${encodeURIComponent(filename)}`;
}

/**
 * Apaga arquivos que ninguém referencia.
 *
 * Existem por dois caminhos normais: alguém escolheu um arquivo, o upload
 * terminou e a pessoa fechou a aba antes de enviar a mensagem; ou o POST da
 * mensagem falhou depois do upload. Nos dois casos fica um arquivo pago pelo
 * volume e sem dono.
 *
 * Roda no boot (instrumentation.ts) e só remove o que tem mais de 24h — um
 * arquivo recém-enviado pode estar exatamente no intervalo entre o upload e o
 * POST da mensagem, e apagá-lo ali seria uma corrida perdida.
 */
export function cleanupOrphanAttachments(referenced: ReadonlySet<string>): number {
  let removed = 0;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = fs.readdirSync(ATTACHMENTS_DIR);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (referenced.has(entry)) continue;
    const full = path.join(ATTACHMENTS_DIR, entry);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs > cutoff) continue;
      fs.unlinkSync(full);
      removed += 1;
    } catch {
      // Sumiu no meio do caminho, ou sem permissão — segue.
    }
  }
  return removed;
}
