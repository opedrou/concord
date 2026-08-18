'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChannelSidebar } from '@/lib/ChannelSidebar';
import { MembersPanel } from '@/lib/MembersPanel';
import { TextChannelPanel } from '@/lib/TextChannelPanel';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { fetchChannels, logout, type Channel } from '@/lib/api-client';
import styles from '../styles/RoomShell.module.css';
import textStyles from '../styles/TextChannelShell.module.css';

/**
 * Envolve uma pagina de canal de texto standalone (/channels/[slug]) com a
 * mesma sidebar da home e da sala de voz. Usado quando NAO ha chamada de voz
 * em andamento (senao o clique no canal de texto abre um painel sobreposto
 * dentro do proprio RoomShell — ver lib/RoomShell.tsx — pra nao desmontar a
 * chamada).
 */
export function TextChannelShell(props: { channelSlug: string }) {
  const { user, loading } = useCurrentUser({ redirectToLogin: true });
  const router = useRouter();
  const [channels, setChannels] = React.useState<Channel[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchChannels()
      .then((list) => {
        if (!cancelled) setChannels(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Não foi possível carregar os canais.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = React.useCallback(async () => {
    try {
      await logout();
    } finally {
      router.push('/login');
    }
  }, [router]);

  if (loading) {
    return null;
  }

  const channel = channels?.find((c) => c.slug === props.channelSlug && c.type === 'text');

  return (
    <div className={styles.shell} data-lk-theme="default">
      <ChannelSidebar user={user} activeTextChannelSlug={props.channelSlug} onLogout={handleLogout} />
      <div className={styles.main}>
        {loadError && <p className={textStyles.centeredMessage}>{loadError}</p>}
        {!loadError && channels === null && (
          <p className={textStyles.centeredMessage}>Carregando…</p>
        )}
        {!loadError && channels !== null && !channel && (
          <p className={textStyles.centeredMessage}>
            Canal de texto não encontrado — pode ter sido removido.
          </p>
        )}
        {channel && (
          <TextChannelPanel channelId={channel.id} channelName={channel.name} currentUser={user} />
        )}
      </div>
      <MembersPanel />
    </div>
  );
}
