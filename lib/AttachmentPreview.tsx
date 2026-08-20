'use client';

// Como um anexo aparece no chat.
//
// A escolha do elemento vem do `kind`, que o SERVIDOR derivou dos magic bytes
// do arquivo (ver lib/uploads.ts) — nunca da extensão do nome nem do
// Content-Type que o navegador de quem enviou declarou. Isso importa: é o que
// impede um arquivo qualquer renomeado pra .png de ser tratado como imagem.

import * as React from 'react';
import type { MessageAttachment } from '@/lib/api-client';
import styles from '../styles/AttachmentPreview.module.css';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPreview({ attachment }: { attachment: MessageAttachment }) {
  if (attachment.kind === 'image') {
    return (
      <a
        className={styles.imageLink}
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        title={`${attachment.name} — ${formatBytes(attachment.size)}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.image} src={attachment.url} alt={attachment.name} loading="lazy" />
      </a>
    );
  }

  if (attachment.kind === 'video') {
    return (
      <video
        className={styles.video}
        src={attachment.url}
        controls
        // Sem isto o navegador baixaria o vídeo inteiro só pra desenhar o
        // player — num histórico com vários clipes, isso seria dezenas de MB
        // por abertura de canal.
        preload="metadata"
      />
    );
  }

  if (attachment.kind === 'audio') {
    return (
      <div className={styles.audioWrap}>
        <span className={styles.fileName}>{attachment.name}</span>
        <audio className={styles.audio} src={attachment.url} controls preload="metadata" />
      </div>
    );
  }

  return (
    <a className={styles.fileCard} href={attachment.url} download={attachment.name}>
      <span className={styles.fileName}>{attachment.name}</span>
      <span className={styles.fileSize}>{formatBytes(attachment.size)}</span>
    </a>
  );
}
