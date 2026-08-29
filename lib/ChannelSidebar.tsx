'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { usePersistentUserChoices } from '@livekit/components-react';
import { fetchChannels, type Channel, type CurrentUser } from '@/lib/api-client';
import { usePresencePolling } from '@/lib/usePresencePolling';
import { useMembersAvatarMap } from '@/lib/useMembersAvatarMap';
import { Avatar } from '@/lib/Avatar';
import {
  HashIcon,
  SpeakerIcon,
  SettingsIcon,
  MicIcon,
  MicOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  VideoIcon,
  ConcordMark,
} from '@/lib/icons';
import { useCallState } from '@/lib/CallStateContext';
import { useSpeakingHold } from '@/lib/useSpeakingHold';
import { getDeafenPrefs, setDeafened, setMicMuted, useDeafenPrefs } from '@/lib/deafenPrefs';
import { stopAllSfx } from '@/lib/sfx';
import { DEFAULT_USER_CHOICES } from '@/lib/userChoices';
import { SettingsWindow, type SettingsSection } from '@/lib/SettingsWindow';
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
   * Chamado quando a pessoa clica no canal de voz em que JA esta. Usado pelo
   * RoomShell pra fechar o painel de texto aberto por cima da chamada — sem
   * isso o clique nao fazia nada (ia num `router.push` pra rota que ja e a
   * atual), e o unico jeito de voltar pra call era achar o botao de fechar.
   */
  onReturnToCall?: () => void;
  /**
   * Largura em px, quando o container em volta (RoomShell) controla o
   * redimensionamento pelo usuario. Sem isso cai no valor fixo do CSS
   * module (usado na home, onde a sidebar nao e arrastavel).
   */
  widthPx?: number;
}

/**
 * Uma linha da lista de ocupantes de um canal de voz, ja normalizada — nao
 * importa se veio do polling (`PresenceParticipant`, sem `speaking`) ou do
 * estado ao vivo (`LiveParticipantState`, chaveado por identity em vez de
 * carregar a identity dentro). O JSX de baixo le so isto, um campo por vez,
 * sem saber de onde a linha veio.
 */
interface OccupantRow {
  identity: string;
  name: string;
  muted: boolean;
  camera: boolean;
  screenShare: boolean;
  speaking: boolean;
}

interface OccupantListItemProps {
  name: string;
  avatarUrl: string | null;
  muted: boolean;
  camera: boolean;
  screenShare: boolean;
  speaking: boolean;
}

// PONTO DE PARTIDA, NAO VALIDADO numa call de verdade (ver R5 em PLANO-2.md).
// Nao copiar o DEFAULT_HOLD_MS=150 do tile (useSpeakingIndicator.ts): aquele
// valor foi calibrado contra o CSS do proprio LiveKit
// (@livekit/components-styles, .lk-participant-tile::after), que ja aplica
// `transition-delay: .5s` + `transition-duration: .4s` ao apagar — quase 1s
// de anti-flicker de graca, so por cima do qual o holdMs do tile precisa
// segurar. O CSS daqui (ChannelSidebar.module.css, .occupantAvatarWrap) e
// simetrico — `transition: box-shadow 0.12s` tanto pra acender quanto pra
// apagar, sem delay nenhum — entao esse hold precisa segurar sozinho as
// pausas normais entre palavras/frases. Em compensacao, o sinal de entrada
// aqui e `room.activeSpeakers`, agregado e suavizado no servidor (mais
// grosso e mais espacado que o nivel de audio cru que o tile mede local),
// entao nao precisa do mesmo tanto de margem que um nivel instavel pediria.
// 400ms e o meio-termo escolhido com esse raciocinio, sem medicao real.
const SIDEBAR_SPEAKING_HOLD_MS = 400;

/**
 * Uma linha de ocupante, isolada com `React.memo`. O `CallStateBinder`
 * reconstroi o mapa `byIdentity` inteiro e republica a cada
 * `ActiveSpeakersChanged` do LiveKit — evento que dispara o tempo todo numa
 * conversa normal — trocando o `value` do `CallStateContext` inteiro. Sem
 * este memo, a `ChannelSidebar` inteira (todas as secoes, todo o dedupe,
 * todos os `<li>`) rediffaria a cada transicao de fala. So funciona porque
 * toda prop aqui e primitiva: passar o `OccupantRow` inteiro ou o
 * `avatarMap` inteiro (objetos recriados a cada render do pai) faria o
 * comparador raso do memo falhar sempre.
 *
 * `speaking` (prop) e o booleano CRU vindo do `CallStateBinder`
 * (`room.activeSpeakers` agregado no servidor — ver R5 em PLANO-2.md). Sem
 * suavizacao ele pisca a cada oscilacao do agregador; `useSpeakingHold`
 * segura o "aceso" por `SIDEBAR_SPEAKING_HOLD_MS` depois que ele cai, sem
 * mexer em como o sinal chega ate aqui. Como este componente e chaveado por
 * identity e fica montado enquanto a pessoa esta na lista, o estado do hold
 * fica estavel por pessoa e some sozinho (com o timer) quando ela sai.
 */
const OccupantListItem = React.memo(function OccupantListItem({
  name,
  avatarUrl,
  muted,
  camera,
  screenShare,
  speaking,
}: OccupantListItemProps) {
  const heldSpeaking = useSpeakingHold(speaking, SIDEBAR_SPEAKING_HOLD_MS);
  return (
    <li className={styles.occupant}>
      <span
        className={`${styles.occupantAvatarWrap} ${heldSpeaking ? styles.occupantSpeaking : ''}`}
      >
        <Avatar username={name} avatarUrl={avatarUrl} size={24} />
      </span>
      <span className={styles.occupantName} title={name}>
        {name}
      </span>
      {/* Icones so aparecem quando ha o que dizer: nada
          de icone "ligado" permanente competindo com o
          nome. Mudo e o unico estado negativo mostrado —
          microfone aberto e o normal e nao precisa de
          simbolo. */}
      {/* Os icones de lib/icons.tsx sao sempre
          `aria-hidden` por construcao; o texto
          acessivel vai no elemento que os envolve —
          convencao documentada no topo daquele
          arquivo. */}
      <span className={styles.occupantBadges}>
        {screenShare && (
          <span className={styles.liveBadge} title="Compartilhando tela">
            LIVE
          </span>
        )}
        {camera && (
          <span
            className={styles.occupantIcon}
            role="img"
            aria-label="Camera ligada"
            title="Camera ligada"
          >
            <VideoIcon size={14} />
          </span>
        )}
        {muted && (
          <span
            className={`${styles.occupantIcon} ${styles.occupantIconMuted}`}
            role="img"
            aria-label="Microfone mudo"
            title="Microfone mudo"
          >
            <MicOffIcon size={14} />
          </span>
        )}
      </span>
    </li>
  );
});

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
  // Estado ao vivo do canal em que voce esta (null fora de uma call, ex.:
  // home e canais de texto). Ver lib/CallStateContext.tsx.
  const callState = useCallState();
  const avatarMap = useMembersAvatarMap();
  const router = useRouter();
  // Fone (surdo) e microfone do rodape. O estado NAO vem do Room — vem de uma
  // store de modulo (lib/deafenPrefs.ts), justamente porque esta sidebar
  // tambem renderiza fora de uma call. Ver o comentario no rodape.
  const { deafened, micMuted } = useDeafenPrefs();
  // A mesma chave `lk-user-choices` que a ControlBar da call grava e o
  // PageClientImpl le pra decidir se publica o microfone ao conectar (ver
  // lib/userChoices.ts). Sem gravar aqui, mutar fora da call e entrar num
  // canal abriria o microfone por um instante antes de o <DeafenBinder />
  // mutar de volta.
  const { saveAudioInputEnabled } = usePersistentUserChoices({ defaults: DEFAULT_USER_CHOICES });

  const handleToggleMic = React.useCallback(() => {
    setMicMuted(!getDeafenPrefs().micMuted);
    saveAudioInputEnabled(!getDeafenPrefs().micMuted);
  }, [saveAudioInputEnabled]);

  const handleToggleDeafen = React.useCallback(() => {
    const next = !getDeafenPrefs().deafened;
    setDeafened(next);
    if (next) {
      // Um som da soundboard pode estar tocando agora; o `playSfx` so barra os
      // proximos. Cortar o que ja esta no ar e o resto de "nada entra".
      stopAllSfx();
    }
    // Ficar surdo muta junto, e sair do surdo devolve o microfone ao estado
    // anterior — os dois casos mexem no mute, entao a preferencia salva
    // acompanha.
    saveAudioInputEnabled(!getDeafenPrefs().micMuted);
  }, [saveAudioInputEnabled]);

  // A janela de configuracoes abre SOBREPOSTA, nunca por navegacao: navegar
  // desmontaria o PageClientImpl e derrubaria a chamada em andamento. Mesmo
  // motivo e mesma solucao do canal de texto (ver RoomShell.tsx). O estado
  // mora aqui, e nao dentro da janela, porque a janela desmonta ao fechar.
  const [settingsSection, setSettingsSection] = React.useState<SettingsSection | null>(null);
  const closeSettings = React.useCallback(() => setSettingsSection(null), []);

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

  const { onReturnToCall } = props;

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
      if (props.activeChannelSlug === channel.slug) {
        // Ja estou nesta call. Clicar de novo e "me leva de volta pra ela":
        // fecha o que estiver por cima (canal de texto) e fica por isso mesmo.
        // O `router.push` la embaixo seria no-op nesse caso.
        onReturnToCall?.();
        return;
      }
      if (props.activeChannelSlug && props.activeChannelSlug !== channel.slug) {
        // Trocando de canal de voz com uma chamada em andamento. Isto aqui ja
        // foi um `window.location.href` (reload completo da pagina) e hoje e
        // navegacao client-side normal — mas so funciona por causa de uma
        // peca no RoomShell, entao vale o comentario:
        //
        // As duas URLs batem no MESMO segmento de rota (`/rooms/[roomName]`),
        // e o App Router do Next NAO desmonta a arvore de componentes so
        // porque o parametro dinamico mudou — ele re-renderiza o mesmo
        // RoomShell/PageClientImpl com `roomName` novo. Como o `Room` vem de
        // um `useMemo` com deps VAZIAS (de proposito, pra nao cair a chamada
        // — ver PageClientImpl.tsx), o cleanup de unmount que chama
        // `room.disconnect()` nao dispararia sozinho nessa troca: o `<Room>`
        // velho continuaria conectado no canal errado enquanto a UI ja mostra
        // o novo. Por isso o RoomShell da uma `key={roomName}` ao
        // PageClientImpl: a troca de canal vira desmontar + montar de novo,
        // o disconnect roda e um `Room` novo e criado pro canal novo. Ver o
        // comentario no RoomShell.tsx.
        //
        // Fecha tambem o painel de texto aberto por cima da call, se houver:
        // quem clica num canal de voz quer ir PRA CALL. O reload fazia isso
        // de graca (estado local morria junto com a pagina).
        onReturnToCall?.();
        router.push(`/rooms/${encodeURIComponent(channel.slug)}`);
        return;
      }
      router.push(`/rooms/${encodeURIComponent(channel.slug)}`);
    },
    [router, props.user, props.activeChannelSlug, applyOptimisticJoin, onReturnToCall],
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
      style={
        props.widthPx
          ? ({ '--sidebar-width': `${props.widthPx}px` } as React.CSSProperties)
          : undefined
      }
    >
      {/* Cabecalho de marca. Nao existia: a sidebar comecava direto em
          "Canais de texto" e o nome do app so aparecia na home. No projeto de
          design ele ancora a coluna inteira — e e o unico lugar onde a marca
          fica visivel enquanto voce usa o app. */}
      <div className={styles.brand}>
        <ConcordMark size={34} />
        <span className={styles.brandName}>Concord</span>
      </div>

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
              // So o canal em que voce esta CONECTADO tem estado ao vivo (ver
              // CallStateContext.tsx) — e la ele e a fonte INTEIRA da lista,
              // nao um verniz por cima do polling: o polling so descobre que
              // alguem entrou ou saiu no proximo tick (ate 4s de atraso, ver
              // usePresencePolling.ts), mas o `CallStateBinder` ja escuta
              // ParticipantConnected/ParticipantDisconnected e publica na
              // hora. Nos demais canais nao existe conexao nenhuma pra tirar
              // esse dado, entao o polling continua sendo a unica fonte.
              const occupants: OccupantRow[] =
                callState?.slug === channel.slug
                  ? Object.entries(callState.byIdentity).map(([identity, p]) => ({
                      identity,
                      name: p.name,
                      muted: p.muted,
                      camera: p.camera,
                      screenShare: p.screenShare,
                      speaking: p.speaking,
                    }))
                  : (presence[channel.slug] ?? []).map((p) => ({
                      identity: p.identity,
                      name: p.name,
                      muted: p.muted,
                      camera: p.camera,
                      screenShare: p.screenShare,
                      // O polling nao sabe quem esta falando agora — isso so
                      // existe no estado ao vivo, e so pro canal em que voce
                      // esta.
                      speaking: false,
                    }));
              const isActive = channel.slug === props.activeChannelSlug;

              // Defesa extra contra o bug da pessoa duplicada (ver
              // PageClientImpl.tsx e HANDOFF secao 9): mesmo com o
              // room.disconnect() correto no unmount, uma sessao fantasma
              // ainda pode sobreviver por alguns segundos ate expirar no SFU
              // (ex: aba fechada sem chegar a rodar o cleanup do React, ou o
              // proprio timeout normal do servidor). Deduplicamos por
              // `cleanName` na EXIBICAO — duas entradas pra mesma pessoa
              // (do polling, do estado ao vivo, ou uma de cada enquanto o
              // SFU nao expirou a sessao fantasma) viram um so avatar na
              // lista, mesmo que as identities (com sufixo aleatorio
              // diferente) continuem existindo de verdade no LiveKit.
              const seenNames = new Set<string>();
              const dedupedOccupants = occupants
                .filter((p) => {
                  const cleanName = p.name || p.identity;
                  if (seenNames.has(cleanName)) return false;
                  seenNames.add(cleanName);
                  return true;
                })
                // O estado ao vivo reconstroi o mapa INTEIRO a cada evento do
                // LiveKit (ver CallStateBinder.tsx), com o participante local
                // sempre primeiro — uma ordem diferente da do polling.
                // Ordenar por nome evita a lista pular de lugar a cada troca
                // de fonte ou a cada evento.
                .sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity));

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
                  </button>
                  {/* FORA do <button> do canal de proposito: um <ul>/<li>
                      dentro de <button> nao seria HTML valido. Uma linha por
                      pessoa, estilo Discord: foto redonda + nome + os icones
                      de estado a direita. */}
                  {dedupedOccupants.length > 0 && (
                    <ul className={styles.occupantList} aria-label={`Pessoas em ${channel.name}`}>
                      {dedupedOccupants.map((p) => {
                        // Casa por `name` (username limpo), nunca por
                        // `identity` — a identity carrega o sufixo aleatorio
                        // `${username}__${randomString(4)}` (ver
                        // connection-details/route.ts), que nunca bate com
                        // as chaves de avatarMap (indexado por username).
                        const cleanName = p.name || p.identity;

                        return (
                          <OccupantListItem
                            key={p.identity}
                            name={cleanName}
                            avatarUrl={avatarMap[cleanName]?.avatarUrl ?? null}
                            muted={p.muted}
                            camera={p.camera}
                            screenShare={p.screenShare}
                            speaking={p.speaking}
                          />
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Rodape estilo Discord: foto redonda + bolinha de status, nome em
          cima e "Online" embaixo, botoes de mic/fone/tema/engrenagem a
          direita. Mic e fone sao botoes DE VERDADE e funcionam tambem fora de
          uma call: o estado deles nao mora no Room, mora numa store de modulo
          persistida (lib/deafenPrefs.ts), e quem aplica ao Room — quando ha um
          — e o <DeafenBinder />. */}
      <div className={styles.userBar}>
        {props.user ? (
          <>
            {/* Clicar em si mesmo abre o perfil — atalho que o Discord tem
                e que evita ter que caçar a secao dentro da janela. */}
            <div
              className={styles.userIdentity}
              role="button"
              tabIndex={0}
              title="Abrir seu perfil"
              onClick={() => setSettingsSection('profile')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSettingsSection('profile');
                }
              }}
            >
              <span className={styles.avatarWrap}>
                <Avatar
                  username={props.user.username}
                  avatarUrl={avatarMap[props.user.username]?.avatarUrl ?? null}
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
              {/* Esta sidebar renderiza FORA da arvore do RoomContext (e irma
                  do PageClientImpl, nao descendente), entao nao da pra ler
                  estado de track aqui com os hooks do LiveKit. Estes dois
                  botoes contornam isso pela store de modulo: eles so escrevem
                  a escolha, e o <DeafenBinder /> (montado dentro do
                  RoomContext, ao lado do <MicProcessorBinder />) e quem muta o
                  microfone de verdade e quem espelha de volta o que for
                  decidido na ControlBar da call — os dois nunca discordam.
                  Sem atalho de teclado, de proposito. */}
              <button
                type="button"
                className={`${styles.userIconButton} ${
                  micMuted ? styles.userIconButtonDanger : ''
                }`}
                aria-label={micMuted ? 'Ligar o microfone' : 'Desligar o microfone'}
                aria-pressed={micMuted}
                title={micMuted ? 'Ligar o microfone' : 'Desligar o microfone'}
                onClick={handleToggleMic}
              >
                {micMuted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
              </button>
              <button
                type="button"
                className={`${styles.userIconButton} ${
                  deafened ? styles.userIconButtonDanger : ''
                }`}
                aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
                aria-pressed={deafened}
                title={
                  deafened
                    ? 'Voltar a ouvir (devolve o microfone ao estado anterior)'
                    : 'Parar de ouvir (silencia tudo e muta voce junto)'
                }
                onClick={handleToggleDeafen}
              >
                {deafened ? <HeadphonesOffIcon size={16} /> : <HeadphonesIcon size={16} />}
              </button>
              {/* Uma engrenagem, uma janela. Antes isto abria um popover de
                  20rem que so tinha audio + links de conta; tudo virou secao
                  da mesma janela (ver lib/SettingsWindow.tsx). */}
              <button
                type="button"
                className={styles.userIconButton}
                aria-haspopup="dialog"
                aria-expanded={settingsSection !== null}
                aria-label="Configurações"
                onClick={() => setSettingsSection('voice')}
              >
                <SettingsIcon size={16} />
              </button>
            </div>
          </>
        ) : (
          <span className={styles.userName}>...</span>
        )}
      </div>

      {/* Portalizada pro <body> (ver AccountOverlay), mas montada DENTRO desta
          arvore de proposito: assim o ramo irmao — o PageClientImpl com o
          <Room> — nunca desmonta, e a voz continua tocando por baixo. */}
      {settingsSection !== null && props.user && (
        <SettingsWindow
          username={props.user.username}
          isAdmin={props.user.isAdmin}
          initialSection={settingsSection}
          onClose={closeSettings}
          onLogout={props.onLogout}
        />
      )}
    </nav>
  );
}
