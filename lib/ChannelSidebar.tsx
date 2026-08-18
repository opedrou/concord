'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { fetchChannels, type Channel, type CurrentUser } from '@/lib/api-client';
import { usePresencePolling } from '@/lib/usePresencePolling';
import styles from '../styles/ChannelSidebar.module.css';

// Icone de alto-falante (canal de voz), estilo Discord. SVG inline pra nao
// depender de biblioteca de icones extra.
function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10v4h3.5l4.5 4V6l-4.5 4H3z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

export interface ChannelSidebarProps {
  user: CurrentUser | null;
  /** Slug do canal em que o usuario esta agora (rota /rooms/[roomName]), se algum. */
  activeChannelSlug?: string;
  onLogout?: () => void;
}

/**
 * Sidebar permanente de canais de voz, estilo Discord: lista os canais e, sob
 * cada um, quem esta dentro agora — sem precisar entrar pra ver.
 */
export function ChannelSidebar(props: ChannelSidebarProps) {
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  const { presence, applyOptimisticJoin } = usePresencePolling();
  const router = useRouter();

  React.useEffect(() => {
    let cancelled = false;
    fetchChannels()
      .then((list) => {
        if (!cancelled) setChannels(list);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnter = React.useCallback(
    (channel: Channel) => {
      // Atualiza a presenca localmente na hora — nao espera o proximo poll
      // pra sidebar refletir que voce entrou.
      if (props.user) {
        applyOptimisticJoin(channel.slug, {
          identity: props.user.username,
          name: props.user.username,
        });
      }
      if (props.activeChannelSlug && props.activeChannelSlug !== channel.slug) {
        // Trocando de canal com uma chamada em andamento: navegacao client-side
        // (router.push) so troca o roomName por baixo e o <Room> antigo nunca
        // chama disconnect() em lugar nenhum do PageClientImpl — a conexao
        // WebRTC com o canal anterior ficaria pendurada. Forcar um reload
        // completo garante que o navegador derruba a conexao antiga antes de
        // abrir a nova.
        window.location.href = `/rooms/${encodeURIComponent(channel.slug)}`;
        return;
      }
      router.push(`/rooms/${encodeURIComponent(channel.slug)}`);
    },
    [router, props.user, props.activeChannelSlug, applyOptimisticJoin],
  );

  return (
    <nav className={styles.sidebar} aria-label="Canais de voz">
      <div className={styles.header}>
        <span className={styles.headerTitle}>Canais de voz</span>
      </div>

      <ul className={styles.channelList}>
        {loadError && <li className={styles.error}>Nao foi possivel carregar os canais.</li>}
        {channels.map((channel) => {
          const occupants = presence[channel.slug] ?? [];
          const isActive = channel.slug === props.activeChannelSlug;
          return (
            <li key={channel.id}>
              <button
                type="button"
                className={`${styles.channelButton} ${isActive ? styles.channelButtonActive : ''}`}
                onClick={() => handleEnter(channel)}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className={styles.channelName}>
                  <SpeakerIcon />
                  {channel.name}
                </span>
                {occupants.length > 0 && (
                  <ul className={styles.occupantList}>
                    {occupants.map((p) => (
                      <li key={p.identity} className={styles.occupant}>
                        {p.name || p.identity}
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            </li>
          );
        })}
        {!loadError && channels.length === 0 && (
          <li className={styles.empty}>Nenhum canal disponivel.</li>
        )}
      </ul>

      <div className={styles.userBar}>
        {props.user ? (
          <>
            <span className={styles.userName} title={props.user.username}>
              {props.user.username}
            </span>
            <div className={styles.userActions}>
              {props.user.isAdmin && (
                <a href="/admin" className={styles.userAction}>
                  Admin
                </a>
              )}
              <button type="button" className={styles.userAction} onClick={props.onLogout}>
                Sair
              </button>
            </div>
          </>
        ) : (
          <span className={styles.userName}>...</span>
        )}
      </div>
    </nav>
  );
}
