'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { VideoCodec } from 'livekit-client';
import { PageClientImpl } from '@/app/rooms/[roomName]/PageClientImpl';
import { ChannelSidebar } from '@/lib/ChannelSidebar';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { logout } from '@/lib/api-client';
import styles from '../styles/RoomShell.module.css';

// Envolve a pagina de sala com a mesma sidebar de canais da home, pra dar pra
// trocar de canal com um clique sem precisar voltar pra lista — sem tocar no
// PageClientImpl alem de repassar o `username` resolvido pela sessao.
export function RoomShell(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
}) {
  const { user, loading } = useCurrentUser({ redirectToLogin: true });
  const router = useRouter();

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

  return (
    <div className={styles.shell} data-lk-theme="default">
      <ChannelSidebar user={user} activeChannelSlug={props.roomName} onLogout={handleLogout} />
      <div className={styles.main}>
        <PageClientImpl
          roomName={props.roomName}
          region={props.region}
          hq={props.hq}
          codec={props.codec}
          singlePeerConnection={props.singlePeerConnection}
          username={user?.username}
        />
      </div>
    </div>
  );
}
