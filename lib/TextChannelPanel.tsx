'use client';

import * as React from 'react';
import {
  apiErrorMessage,
  channelMessageStreamUrl,
  deleteMessage,
  fetchMessages,
  postMessage,
  uploadAttachment,
  type ChannelMessage,
  type CurrentUser,
  type UploadedAttachment,
} from '@/lib/api-client';
import { ATTACHMENT_MAX_DIMENSION, resizeImageClientSide } from '@/lib/resizeImageClientSide';
import { AttachmentPreview, formatBytes } from '@/lib/AttachmentPreview';
import { CloseIcon, HashIcon } from '@/lib/icons';
import { Avatar } from '@/lib/Avatar';
import { useMembersAvatarMap } from '@/lib/useMembersAvatarMap';
import styles from '../styles/TextChannelPanel.module.css';

const PAGE_SIZE = 50;
// Mensagens seguidas do mesmo autor dentro dessa janela agrupam visualmente
// (sem repetir nome/horario) — mesma ideia do Discord.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatFullDateTime(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR');
}

export interface TextChannelPanelProps {
  channelId: number;
  channelName: string;
  currentUser: CurrentUser | null;
  /** Quando informado, mostra um botao de fechar (uso no painel sobreposto do RoomShell). */
  onClose?: () => void;
}

/**
 * Historico + composer de um canal de texto. Reaproveitado tanto na pagina
 * standalone (/channels/[slug]) quanto no painel sobreposto do RoomShell
 * (aberto por cima de uma chamada de voz em andamento, sem desmontar ela).
 */
export function TextChannelPanel(props: TextChannelPanelProps) {
  const { channelId } = props;
  // Mesmo mapa que os tiles da chamada usam — chaveado por `name` limpo, ver
  // useMembersAvatarMap.ts. Sem foto cadastrada, o <Avatar> cai nas iniciais.
  const avatarMap = useMembersAvatarMap();
  const [messages, setMessages] = React.useState<ChannelMessage[] | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  // Anexo escolhido mas ainda nao enviado. O upload comeca na hora da escolha
  // (nao no "Enviar"): num arquivo de dezenas de MB, esperar o clique pra
  // comecar a subir faria o botao ficar travado por minutos.
  const [pending, setPending] = React.useState<UploadedAttachment | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);

  const seenIds = React.useRef<Set<number>>(new Set());
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = React.useRef(true);

  // Reseta tudo ao trocar de canal (troca de slug/id, nao so re-render).
  React.useEffect(() => {
    setMessages(null);
    setHasMore(false);
    setLoadError(null);
    seenIds.current = new Set();

    let cancelled = false;
    fetchMessages(channelId, { limit: PAGE_SIZE })
      .then((page) => {
        if (cancelled) return;
        for (const m of page.messages) seenIds.current.add(m.id);
        setMessages(page.messages);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(apiErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  // Rola pro fim quando a primeira pagina chega, e de novo a cada mensagem
  // nova SE o usuario ja estava perto do fim (nao interrompe quem rolou pra
  // ler historico antigo).
  React.useEffect(() => {
    if (messages !== null && isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  const appendOrUpdate = React.useCallback((message: ChannelMessage) => {
    if (seenIds.current.has(message.id)) return;
    seenIds.current.add(message.id);
    setMessages((prev) => (prev ? [...prev, message] : [message]));
  }, []);

  const removeMessage = React.useCallback((messageId: number) => {
    seenIds.current.delete(messageId);
    setMessages((prev) => (prev ? prev.filter((m) => m.id !== messageId) : prev));
  }, []);

  // Tempo real via SSE (ver app/api/channels/[id]/messages/stream/route.ts).
  // EventSource reconecta sozinho em caso de queda de rede — nao precisamos
  // de retry manual aqui.
  React.useEffect(() => {
    const source = new EventSource(channelMessageStreamUrl(channelId));
    source.addEventListener('message', (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as
          | { type: 'created'; message: ChannelMessage }
          | { type: 'deleted'; messageId: number; channelId: number };
        if (payload.type === 'created') {
          appendOrUpdate(payload.message);
        } else {
          removeMessage(payload.messageId);
        }
      } catch {
        // evento malformado — ignora, nao derruba a conexao por isso.
      }
    });
    return () => source.close();
  }, [channelId, appendOrUpdate, removeMessage]);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
  }, []);

  const loadMore = React.useCallback(async () => {
    if (!messages || messages.length === 0 || loadingMore) return;
    setLoadingMore(true);
    const el = scrollRef.current;
    const previousScrollHeight = el?.scrollHeight ?? 0;
    try {
      const oldestId = messages[0].id;
      const page = await fetchMessages(channelId, { before: oldestId, limit: PAGE_SIZE });
      for (const m of page.messages) seenIds.current.add(m.id);
      setMessages((prev) => [...page.messages, ...(prev ?? [])]);
      setHasMore(page.hasMore);
      // Mantem a posicao de leitura: sem isso, prepender historico empurra
      // a tela e o usuario perde onde estava.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - previousScrollHeight;
      });
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [channelId, messages, loadingMore]);

  const handleSend = React.useCallback(async () => {
    const content = draft.trim();
    // Mensagem so com anexo e valida — mandar uma foto sem legenda e o caso
    // mais comum de anexo.
    if ((!content && !pending) || sending || uploading) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await postMessage(channelId, content, pending);
      appendOrUpdate(message);
      setDraft('');
      setPending(null);
      isNearBottomRef.current = true;
    } catch (err) {
      setSendError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }, [channelId, draft, pending, sending, uploading, appendOrUpdate]);

  const handleFiles = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setSendError(null);
    setUploading(true);
    setUploadProgress(0);
    try {
      // Imagem grande de celular passa dos 10 MB sem precisar: encolher no
      // cliente (o mesmo caminho que a foto de perfil ja usa) economiza banda
      // de subida de quem manda e espaco no volume. Video e audio vao inteiros
      // — recomprimir isso no navegador seria lento e pioraria a qualidade.
      const payload = file.type.startsWith('image/')
        ? new File([await resizeImageClientSide(file, ATTACHMENT_MAX_DIMENSION)], file.name, {
            type: 'image/jpeg',
          })
        : file;
      const uploaded = await uploadAttachment(payload, { onProgress: setUploadProgress });
      setPending(uploaded);
    } catch (err) {
      setSendError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleDelete = React.useCallback(
    async (messageId: number) => {
      try {
        await deleteMessage(channelId, messageId);
        removeMessage(messageId);
      } catch (err) {
        setSendError(apiErrorMessage(err));
      }
    },
    [channelId, removeMessage],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          <HashIcon size={16} />
          {props.channelName}
        </span>
        {props.onClose && (
          <button
            type="button"
            className={styles.closeButton}
            onClick={props.onClose}
            aria-label="Fechar"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      <div
        className={styles.scrollArea}
        ref={scrollRef}
        onScroll={handleScroll}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFiles(e.dataTransfer.files);
        }}
      >
        {loadError && (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        )}

        {messages === null && !loadError && <p className={styles.muted}>Carregando mensagens…</p>}

        {messages !== null && messages.length === 0 && !loadError && (
          <p className={styles.muted}>Nenhuma mensagem ainda. Seja o primeiro a escrever.</p>
        )}

        {messages !== null && messages.length > 0 && (
          <>
            {hasMore && (
              <div className={styles.loadMoreRow}>
                <button
                  type="button"
                  className="lk-button"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Carregando…' : 'Carregar mais'}
                </button>
              </div>
            )}

            <ul className={styles.messageList}>
              {messages.map((message, index) => {
                const previous = index > 0 ? messages[index - 1] : null;
                const groupedWithPrevious =
                  previous !== null &&
                  previous.authorId === message.authorId &&
                  message.createdAt - previous.createdAt < GROUP_WINDOW_MS;
                const canDelete =
                  props.currentUser?.isAdmin || message.authorId === props.currentUser?.id;

                return (
                  <li
                    key={message.id}
                    className={`${styles.messageRow} ${
                      groupedWithPrevious ? styles.messageGrouped : styles.message
                    }`}
                  >
                    {/* Calha fixa a esquerda: foto na primeira mensagem de cada
                        bloco, vazia nas seguintes. E ela que alinha o texto de
                        todas as linhas do bloco na mesma coluna — sem isso a
                        continuacao ficaria colada na margem. */}
                    <div className={styles.gutter}>
                      {!groupedWithPrevious && (
                        <Avatar
                          username={message.authorName}
                          avatarUrl={avatarMap[message.authorName]}
                          size={42}
                        />
                      )}
                    </div>
                    <div className={styles.messageMain}>
                      {!groupedWithPrevious && (
                        <div className={styles.messageMeta}>
                          <span className={styles.authorName}>{message.authorName}</span>
                          <span
                            className={styles.timestamp}
                            title={formatFullDateTime(message.createdAt)}
                          >
                            {formatTime(message.createdAt)}
                          </span>
                        </div>
                      )}
                      <div className={styles.messageBody}>
                        {message.content && (
                          <span className={styles.messageContent}>{message.content}</span>
                        )}
                        {message.attachment && (
                          <AttachmentPreview attachment={message.attachment} />
                        )}
                        {groupedWithPrevious && (
                          <span
                            className={styles.hoverTimestamp}
                            title={formatFullDateTime(message.createdAt)}
                          >
                            {formatTime(message.createdAt)}
                          </span>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className={styles.deleteButton}
                            onClick={() => handleDelete(message.id)}
                            aria-label="Apagar mensagem"
                          >
                            Apagar
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div ref={bottomRef} />
      </div>

      <div className={styles.composer}>
        {sendError && (
          <p className={styles.error} role="alert">
            {sendError}
          </p>
        )}
        {uploading && (
          <div className={styles.uploadRow}>
            <span>Enviando arquivo… {Math.round(uploadProgress * 100)}%</span>
            <progress className={styles.progress} value={uploadProgress} max={1} />
          </div>
        )}

        {pending && !uploading && (
          <div className={styles.pendingRow}>
            <span className={styles.pendingName}>
              {pending.name} · {formatBytes(pending.size)}
            </span>
            <button
              type="button"
              className={styles.pendingRemove}
              onClick={() => setPending(null)}
              aria-label="Remover anexo"
              title="Remover anexo"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            // Permite escolher o MESMO arquivo de novo depois de remover.
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={`lk-button ${styles.composerButton}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || sending || pending !== null}
          title={pending ? 'Só um anexo por mensagem' : 'Anexar arquivo'}
        >
          Anexar
        </button>
        <textarea
          className={styles.textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            // Colar print direto no campo é como se manda captura de tela na
            // prática — sem isto a pessoa teria que salvar em arquivo antes.
            const file = e.clipboardData?.files?.[0];
            if (file) {
              e.preventDefault();
              void handleFiles(e.clipboardData.files);
            }
          }}
          placeholder={`Conversar em #${props.channelName}`}
          rows={1}
          maxLength={4000}
          disabled={sending}
        />
        <button
          type="button"
          className={`lk-button ${styles.sendButton}`}
          onClick={handleSend}
          disabled={sending || uploading || (!draft.trim() && !pending)}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
