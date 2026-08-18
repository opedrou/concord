'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { fetchChannels, type Channel, type CurrentUser } from '@/lib/api-client';
import { usePresencePolling } from '@/lib/usePresencePolling';
import { useMembersAvatarMap } from '@/lib/useMembersAvatarMap';
import { Avatar } from '@/lib/Avatar';
import { HashIcon, SpeakerIcon, SettingsIcon } from '@/lib/icons';
import styles from '../styles/ChannelSidebar.module.css';

export interface ChannelSidebarProps {
  user: CurrentUser | null;
  /** Slug do canal de VOZ em que o usuario esta agora (rota /rooms/[roomName]), se algum. */
  activeChannelSlug?: string;
  /** Slug do canal de TEXTO sendo visualizado agora, se algum. */
  activeTextChannelSlug?: string;
  onLogout?: () => void;
  /**
   * Quando informado, clicar num canal de texto chama isso em vez de navegar
   * pra /channels/[slug]. Usado pelo RoomShell pra abrir o texto num painel
   * sobreposto sem desmontar a chamada de voz em andamento (ver RoomShell.tsx).
   */
  onSelectTextChannel?: (channel: Channel) => void;
  /**
   * Largura em px, quando o container em volta (RoomShell) controla o
   * redimensionamento pelo usuario. Sem isso cai no valor fixo do CSS
   * module (usado na home, onde a sidebar nao e arrastavel).
   */
  widthPx?: number;
}

/**
 * Sidebar permanente de canais, estilo Discord: duas secoes (texto com "#" e
 * voz com alto-falante). Sob cada canal de voz mostra quem esta dentro agora
 * — sem precisar entrar pra ver. Canal de texto nao tem presenca (nao
 * "entra" em nada, so abre o historico).
 */
export function ChannelSidebar(props: ChannelSidebarProps) {
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [loadError, setLoadError] = React.useState<Error | null>(null);
  const { presence, applyOptimisticJoin } = usePresencePolling();
  const avatarMap = useMembersAvatarMap();
  const router = useRouter();
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false);

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

  const handleEnterVoice = React.useCallback(
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
        // Trocando de canal de voz com uma chamada em andamento: navegacao
        // client-side (router.push) so troca o roomName por baixo e o <Room>
        // antigo nunca chama disconnect() em lugar nenhum do PageClientImpl —
        // a conexao WebRTC com o canal anterior ficaria pendurada. Forcar um
        // reload completo garante que o navegador derruba a conexao antiga
        // antes de abrir a nova.
        window.location.href = `/rooms/${encodeURIComponent(channel.slug)}`;
        return;
      }
      router.push(`/rooms/${encodeURIComponent(channel.slug)}`);
    },
    [router, props.user, props.activeChannelSlug, applyOptimisticJoin],
  );

  const { onSelectTextChannel } = props;
  const handleEnterText = React.useCallback(
    (channel: Channel) => {
      if (onSelectTextChannel) {
        // Contexto de dentro de uma sala de voz: abre em painel sobreposto,
        // sem navegar (a chamada continua tocando por baixo).
        onSelectTextChannel(channel);
        return;
      }
      // Fora de uma sala de voz: navegacao client-side normal, nao ha
      // conexao WebRTC pra proteger.
      router.push(`/channels/${encodeURIComponent(channel.slug)}`);
    },
    [router, onSelectTextChannel],
  );

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  return (
    <nav
      className={styles.sidebar}
      aria-label="Canais"
      // Variavel CSS, nao a propriedade `width` direta: inline style sempre
      // vence qualquer regra de classe, e isso quebraria o media query de
      // tela estreita (que precisa forcar width:100%, ver
      // ChannelSidebar.module.css). Passando por variavel, quem decide o
      // valor final continua sendo a cascata normal do CSS.
      style={props.widthPx ? ({ '--sidebar-width': `${props.widthPx}px` } as React.CSSProperties) : undefined}
    >
      {loadError && <p className={styles.error}>Nao foi possivel carregar os canais.</p>}

      {!loadError && channels.length === 0 && (
        <p className={styles.empty}>Nenhum canal disponivel.</p>
      )}

      {textChannels.length > 0 && (
        <div className={styles.section}>
          <div className={styles.header}>
            <span className={styles.headerTitle}>Canais de texto</span>
          </div>
          <ul className={styles.channelList}>
            {textChannels.map((channel) => {
              const isActive = channel.slug === props.activeTextChannelSlug;
              return (
                <li key={channel.id}>
                  <button
                    type="button"
                    className={`${styles.channelButton} ${isActive ? styles.channelButtonActive : ''}`}
                    onClick={() => handleEnterText(channel)}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className={styles.channelName}>
                      <HashIcon />
                      {channel.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {voiceChannels.length > 0 && (
        <div className={styles.section}>
          <div className={styles.header}>
            <span className={styles.headerTitle}>Canais de voz</span>
          </div>
          <ul className={styles.channelList}>
            {voiceChannels.map((channel) => {
              const occupants = presence[channel.slug] ?? [];
              const isActive = channel.slug === props.activeChannelSlug;
              return (
                <li key={channel.id}>
                  <button
                    type="button"
                    className={`${styles.channelButton} ${isActive ? styles.channelButtonActive : ''}`}
                    onClick={() => handleEnterVoice(channel)}
                    aria-current={isActive ? 'true' : undefined}
                  >
                    <span className={styles.channelName}>
                      <SpeakerIcon />
                      {channel.name}
                    </span>
                    {occupants.length > 0 && (
                      <ul className={styles.occupantList}>
                        {occupants.map((p) => {
                          // Casa por `name` (username limpo), nunca por
                          // `identity` — a identity carrega o sufixo
                          // aleatorio `${username}__${randomString(4)}` (ver
                          // connection-details/route.ts), que nunca bate com
                          // as chaves de avatarMap (indexado por username).
                          const cleanName = p.name || p.identity;
                          return (
                            <li key={p.identity} className={styles.occupant}>
                              <Avatar
                                username={cleanName}
                                avatarUrl={avatarMap[cleanName] ?? null}
                                size={20}
                                className={styles.occupantAvatar}
                              />
                              <span className={styles.occupantName}>{cleanName}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Rodape estilo Discord: foto redonda + bolinha de status, nome em
          cima e "Online" embaixo, icones de mic/fone/engrenagem a direita.
          Mic e fone aqui sao so indicadores visuais (ver relatorio: esta
          sidebar tambem renderiza fora de uma call, sem Room por perto pra
          ter estado real de mute/deafen) — a engrenagem e o unico botao de
          verdade, abre o menu com Perfil/Admin/Sair. */}
      <div className={styles.userBar}>
        {props.user ? (
          <>
            <div className={styles.userIdentity}>
              <span className={styles.avatarWrap}>
                <Avatar
                  username={props.user.username}
                  avatarUrl={avatarMap[props.user.username] ?? null}
                  size={32}
                />
                <span className={styles.statusDot} aria-hidden="true" />
              </span>
              <span className={styles.userText}>
                <span className={styles.userName} title={props.user.username}>
                  {props.user.username}
                </span>
                <span className={styles.userStatus}>Online</span>
              </span>
            </div>
            <div className={styles.userActions}>
              {/* Aqui havia icones de microfone e fone puramente decorativos.
                  Foram removidos de proposito: esta sidebar renderiza FORA da
                  arvore do RoomContext (e irma do PageClientImpl, nao
                  descendente), entao nao ha estado de track pra ler nem pra
                  alterar sem reestruturar os providers. Botao que parece
                  clicavel e nao muta nada e pior que botao nenhum. O controle
                  de microfone de verdade esta na ControlBar da call. */}
              <div className={styles.accountMenuWrap}>
                <button
                  type="button"
                  className={styles.userIconButton}
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  aria-label="Configuracoes da conta"
                  onClick={() => setAccountMenuOpen((v) => !v)}
                >
                  <SettingsIcon size={16} />
                </button>
                {accountMenuOpen && (
                  <>
                    <div className={styles.menuBackdrop} onClick={() => setAccountMenuOpen(false)} />
                    <div className={styles.accountMenu} role="menu">
                      <a
                        href="/profile"
                        role="menuitem"
                        className={styles.accountMenuItem}
                        onClick={() => setAccountMenuOpen(false)}
                      >
                        Perfil
                      </a>
                      {props.user.isAdmin && (
                        <a
                          href="/admin"
                          role="menuitem"
                          className={styles.accountMenuItem}
                          onClick={() => setAccountMenuOpen(false)}
                        >
                          Admin
                        </a>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        className={styles.accountMenuItem}
                        onClick={() => {
                          setAccountMenuOpen(false);
                          props.onLogout?.();
                        }}
                      >
                        Sair
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        ) : (
          <span className={styles.userName}>...</span>
        )}
      </div>
    </nav>
  );
}
