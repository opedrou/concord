'use client';

import * as React from 'react';
import {
  apiErrorMessage,
  channelMessageStreamUrl,
  deleteMessage,
  fetchMessages,
  postMessage,
  type ChannelMessage,
  type CurrentUser,
} from '@/lib/api-client';
import { CloseIcon, HashIcon } from '@/lib/icons';
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
  const [messages, setMessages] = React.useState<ChannelMessage[] | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
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
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const message = await postMessage(channelId, content);
      appendOrUpdate(message);
      setDraft('');
      isNearBottomRef.current = true;
    } catch (err) {
      setSendError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }, [channelId, draft, sending, appendOrUpdate]);

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
          <button type="button" className={styles.closeButton} onClick={props.onClose} aria-label="Fechar">
            <CloseIcon size={16} />
          </button>
        )}
      </div>

      <div className={styles.scrollArea} ref={scrollRef} onScroll={handleScroll}>
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
                    className={groupedWithPrevious ? styles.messageGrouped : styles.message}
                  >
                    {!groupedWithPrevious && (
                      <div className={styles.messageMeta}>
                        <span className={styles.authorName}>{message.authorName}</span>
                        <span className={styles.timestamp} title={formatFullDateTime(message.createdAt)}>
                          {formatTime(message.createdAt)}
                        </span>
                      </div>
                    )}
                    <div className={styles.messageBody}>
                      <span className={styles.messageContent}>{message.content}</span>
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
        <textarea
          className={styles.textarea}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Conversar em #${props.channelName}`}
          rows={1}
          maxLength={4000}
          disabled={sending}
        />
        <button
          type="button"
          className="lk-button"
          onClick={handleSend}
          disabled={sending || !draft.trim()}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
