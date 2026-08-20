'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { VideoCodec } from 'livekit-client';
import { PageClientImpl } from '@/app/rooms/[roomName]/PageClientImpl';
import { ChannelSidebar } from '@/lib/ChannelSidebar';
import { MembersPanel } from '@/lib/MembersPanel';
import { TextChannelPanel } from '@/lib/TextChannelPanel';
import { ResizeHandle } from '@/lib/ResizeHandle';
import { usePersistedSize } from '@/lib/usePersistedSize';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { MicProcessorProvider } from '@/lib/MicProcessorContext';
import { CallStateProvider } from './CallStateContext';
import { VolumeMixerProvider } from './VolumeMixerContext';
import { FullscreenProvider, useFullscreen } from './FullscreenContext';
import { logout, type Channel, type CurrentUser } from '@/lib/api-client';
import styles from '../styles/RoomShell.module.css';

// Limites da sidebar de canais na tela de call — largura em px, persistida
// por conta. Mesma ideia da faixa de participantes em CallStage.tsx.
const SIDEBAR_DEFAULT_WIDTH = 288; // 18rem, mesmo valor que ja era fixo no CSS
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;

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

  // Largura da sidebar de canais, arrastavel pelo usuario e persistida —
  // pedido do dono pra poder dar mais espaco ao video sem depender de um
  // valor fixo. Ver ChannelSidebar.tsx (`widthPx`) e ResizeHandle.tsx.
  const [sidebarWidth, setSidebarWidth] = usePersistedSize(
    'concord:sidebarWidth',
    SIDEBAR_DEFAULT_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_MAX_WIDTH,
  );

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
    // O provider precisa envolver a sidebar E a chamada: o painel de
    // configuracoes (dentro da sidebar) e o dono do processamento de audio
    // (dentro do PageClientImpl) estao em ramos IRMAOS da arvore, e este e o
    // ancestral comum mais proximo. Ver lib/MicProcessorContext.tsx.
    <MicProcessorProvider>
      {/* Mesmo motivo do MicProcessorProvider, para outro dado: a sidebar
          precisa do estado ao vivo de mudo/camera/tela, que so existe dentro
          do RoomContext. Ver lib/CallStateContext.tsx. */}
      <CallStateProvider>
        {/* Terceiro contexto com o mesmo desenho, pelo mesmo motivo: os
            sliders de volume moram na janela de configuracoes (dentro da
            sidebar) e quem aplica e um binder dentro do RoomContext. Ver
            lib/VolumeMixerContext.tsx. */}
        <VolumeMixerProvider>
          {/* Precisa envolver a sidebar: no modo teatro ela some, e o estado
            nasce dentro do CallStage. Ver lib/FullscreenContext.tsx. */}
          <FullscreenProvider>
            <div className={styles.shell} data-lk-theme="default">
              <SidebarSlot
                user={user}
                activeChannelSlug={props.roomName}
                activeTextChannelSlug={openTextChannel?.slug}
                onSelectTextChannel={handleSelectTextChannel}
                onLogout={handleLogout}
                width={sidebarWidth}
                onWidthChange={setSidebarWidth}
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
                      Chamada de voz continua em andamento em segundo plano. Feche este canal de
                      texto pra voltar pra ela.
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
              {/* Lista de membros so faz sentido no contexto de canal de TEXTO — na
            tela de call ela so competia por espaco com os controles de video
            (reclamacao original). Por isso so aparece quando o painel de texto
            esta aberto por cima da chamada, nunca durante a call em si. */}
              {openTextChannel && <MembersPanel />}
            </div>
          </FullscreenProvider>
        </VolumeMixerProvider>
      </CallStateProvider>
    </MicProcessorProvider>
  );
}

/** Sidebar + alca de redimensionamento. Existe como componente separado
 * porque precisa CONSUMIR o FullscreenProvider, e quem renderiza o provider
 * (o RoomShell) nao pode consumi-lo no mesmo componente. No modo teatro
 * desmonta — a sidebar e a alca somem junto com todo o resto da UI. */
function SidebarSlot(props: {
  user: CurrentUser | null;
  activeChannelSlug: string;
  activeTextChannelSlug?: string;
  onSelectTextChannel: (channel: Channel) => void;
  onLogout: () => void;
  width: number;
  onWidthChange: (value: number) => void;
}) {
  const fullscreen = useFullscreen();
  if (fullscreen?.mode === 'theater') {
    return null;
  }
  return (
    <>
      <ChannelSidebar
        user={props.user}
        activeChannelSlug={props.activeChannelSlug}
        activeTextChannelSlug={props.activeTextChannelSlug}
        onSelectTextChannel={props.onSelectTextChannel}
        onLogout={props.onLogout}
        widthPx={props.width}
      />
      <ResizeHandle
        orientation="vertical"
        value={props.width}
        min={SIDEBAR_MIN_WIDTH}
        max={SIDEBAR_MAX_WIDTH}
        onChange={props.onWidthChange}
        label="Redimensionar lista de canais"
      />
    </>
  );
}
