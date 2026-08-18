'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { VideoCodec } from 'livekit-client';
import { PageClientImpl } from '@/app/rooms/[roomName]/PageClientImpl';
import { ChannelSidebar } from '@/lib/ChannelSidebar';
import { MembersPanel } from '@/lib/MembersPanel';
import { TextChannelPanel } from '@/lib/TextChannelPanel';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { logout, type Channel } from '@/lib/api-client';
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
  // Canal de texto aberto por cima da chamada, se algum. Guardado como
  // estado local (nao rota) de proposito: navegar pra /channels/[slug]
  // desmontaria PageClientImpl — e ele nao chama room.disconnect() no
  // unmount (debito conhecido, ver HANDOFF.md) — entao a chamada de voz
  // ficaria pendurada. Abrindo como overlay dentro desta mesma arvore, o
  // <Room> do PageClientImpl nunca desmonta: a chamada continua tocando
  // exatamente como no Discord (entrar num canal de texto nao desconecta a
  // chamada em andamento).
  const [openTextChannel, setOpenTextChannel] = React.useState<Channel | null>(null);

  const handleLogout = React.useCallback(async () => {
    try {
      await logout();
    } finally {
      router.push('/login');
    }
  }, [router]);

  const handleSelectTextChannel = React.useCallback((channel: Channel) => {
    setOpenTextChannel(channel);
  }, []);

  const closeTextChannel = React.useCallback(() => setOpenTextChannel(null), []);

  if (loading) {
    return null;
  }

  return (
    <div className={styles.shell} data-lk-theme="default">
      <ChannelSidebar
        user={user}
        activeChannelSlug={props.roomName}
        activeTextChannelSlug={openTextChannel?.slug}
        onSelectTextChannel={handleSelectTextChannel}
        onLogout={handleLogout}
      />
      <div className={styles.main}>
        {/* PageClientImpl fica sempre montado — so escondido via CSS quando o
            painel de texto esta aberto — pra chamada nunca ser interrompida. */}
        <div
          className={styles.callLayer}
          style={{ display: openTextChannel ? 'none' : 'block' }}
          aria-hidden={openTextChannel ? true : undefined}
        >
          <PageClientImpl
            roomName={props.roomName}
            region={props.region}
            hq={props.hq}
            codec={props.codec}
            singlePeerConnection={props.singlePeerConnection}
            username={user?.username}
          />
        </div>
        {openTextChannel && (
          <div className={styles.textLayer}>
            <p className={styles.callBanner}>
              Chamada de voz continua em andamento em segundo plano. Feche este canal de texto pra
              voltar pra ela.
            </p>
            <TextChannelPanel
              channelId={openTextChannel.id}
              channelName={openTextChannel.name}
              currentUser={user}
              onClose={closeTextChannel}
            />
          </div>
        )}
      </div>
      {/* So faz sentido mostrar a lista de membros quando a chamada esta
          visivel — com o painel de texto aberto por cima, a tela ja fica
          apertada (ver banner acima) e o painel de membros comecaria
          recolhido de qualquer forma, entao evitamos so o espaco reservado. */}
      {!openTextChannel && <MembersPanel />}
    </div>
  );
}
