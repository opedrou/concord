'use client';

import * as React from 'react';
import { RemoteParticipant, RemoteTrackPublication, RoomEvent, Track } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import {
  Chat,
  ChatIcon,
  ChatToggle,
  ConnectionStateToast,
  isTrackReference,
  LayoutContextProvider,
  RoomAudioRenderer,
  useCreateLayoutContext,
  useParticipants,
  usePinnedTracks,
  useRoomContext,
  useTracks,
  type MessageDecoder,
  type MessageEncoder,
  type MessageFormatter,
  type TrackReferenceOrPlaceholder,
  type WidgetState,
} from '@livekit/components-react';
import { CallControlBar } from '@/lib/CallControlBar';
import { CallParticipantTile, type WatchControl } from '@/lib/CallParticipantTile';
import { TileErrorBoundary } from '@/lib/TileErrorBoundary';
import { ParticipantVolumeCard, useScreenShareAudioIdentities } from '@/lib/ParticipantAudioPanel';
import { useMembersAvatarMap } from '@/lib/useMembersAvatarMap';
import { useFullscreen } from '@/lib/FullscreenContext';
import { useScreenShareViewers } from '@/lib/useScreenShareViewers';
import { useAudibility } from '@/lib/useAudibility';
import { FocusModeBanner } from '@/lib/FocusModeControl';
import { useVolumeMixer } from '@/lib/VolumeMixerContext';
import { peekScreenShareFrame } from '@/lib/peekScreenShareFrame';
import {
  CollapseIcon,
  ExpandIcon,
  CloseIcon,
  SpeakerIcon,
  Volume2Icon,
  VolumeXIcon,
} from '@/lib/icons';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ResizeHandle } from '@/lib/ResizeHandle';
import { usePersistedSize } from '@/lib/usePersistedSize';
import styles from '../styles/CallStage.module.css';

const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

// Limites da faixa de participantes quando ha transmissao em foco (ver
// styles/CallStage.module.css) — largura em px, persistida por conta.
const STRIP_DEFAULT_WIDTH = 220;
const STRIP_MIN_WIDTH = 160;
const STRIP_MAX_WIDTH = 420;

function trackRefKey(t: TrackReferenceOrPlaceholder): string {
  return `${t.participant.identity}_${t.source}`;
}

function isSameTrackRef(a?: TrackReferenceOrPlaceholder, b?: TrackReferenceOrPlaceholder): boolean {
  if (!a || !b) return a === b;
  return a.participant.identity === b.participant.identity && a.source === b.source;
}

/**
 * Substitui o `<VideoConference>` do @livekit/components-react por
 * composição manual — `GridLayout`/`FocusLayout` (reimplementados aqui de
 * forma simples, ver nota abaixo) + `CallParticipantTile` próprio +
 * `CallControlBar` própria + `Chat` + `RoomAudioRenderer`. Ver relatório para
 * a decisão completa; resumo: `ControlBarProps`/`ParticipantTileProps` não
 * têm slot para os controles que o dono pediu (qualidade de transmissão,
 * volume por participante, foto de perfil no placeholder), e o
 * `<VideoConference>` monta esses componentes internamente sem dar acesso a
 * eles — a única forma suportada de customizar é compor as mesmas peças
 * públicas na mão.
 *
 * **Cuidado que já mordeu uma vez** (ver HANDOFF): `<VideoConference>` traz
 * de graça o `RoomAudioRenderer` — é ele que toca o áudio de todo mundo,
 * inclusive áudio de tela. Esquecer de montá-lo aqui = ninguém ouve ninguém.
 *
 * Não usamos o `<GridLayout>`/`<CarouselLayout>` do próprio LiveKit porque
 * eles clonam o filho recebido sem repassar props (o trackRef vem só do
 * React Context) — funcionaria, mas exigiria ler o trackRef via contexto no
 * lugar de prop, sem ganhar nada, já que o app é pensado pra 2–5 pessoas
 * (ver HANDOFF) e não precisa da paginação por swipe que o `<GridLayout>`
 * da lib resolve para salas grandes. A grade/foco aqui são um CSS simples.
 */
export function CallStage(props: {
  chatMessageFormatter?: MessageFormatter;
  chatMessageEncoder?: MessageEncoder;
  chatMessageDecoder?: MessageDecoder;
  onDeviceError?: (error: { source: Track.Source; error: Error }) => void;
}) {
  const layoutContext = useCreateLayoutContext();
  const room = useRoomContext();
  const participants = useParticipants();
  const [widgetState, setWidgetState] = React.useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    // `updateOnlyOn` veio do <VideoConference> do upstream, que so precisava
    // reagir a quem esta falando. Os dois eventos de subscricao entraram por
    // causa do "parar de assistir" (ver mais abaixo): quando a track volta a
    // ser assinada, `publication.track` so aparece no TrackSubscribed — sem
    // ouvir esse evento, o tile ficaria congelado ate algo mais disparar um
    // render. `onlySubscribed: false` e o que mantem o tile na lista enquanto
    // ela esta dessubscrita, pro botao de voltar a assistir ter onde morar.
    {
      updateOnlyOn: [
        RoomEvent.ActiveSpeakersChanged,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
      ],
      onlySubscribed: false,
    },
  );

  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((t) => t.source === Track.Source.ScreenShare);

  const pinned = usePinnedTracks(layoutContext);
  const focusTrack = pinned?.[0];
  // ANTES: um efeito aqui replicava o <VideoConference> do LiveKit e focava
  // automaticamente a primeira transmissao que aparecesse. Saiu a pedido: cair
  // dentro da transmissao de alguem sem ter clicado em nada e invasivo, gasta
  // banda de quem so queria conversar, e o caminho de volta ("parar de
  // assistir") existia so pra desfazer algo que ninguem pediu. Agora
  // transmissao nova chega DESLIGADA (ver `unwatchedSids` mais abaixo) e o
  // foco so acontece pelo clique em "Assistir" (`startWatching`).
  //
  // O que sobrou de automatico e so a LIMPEZA: se a transmissao que estava em
  // foco acabou, tira o foco — senao a tela inteira ficaria presa num tile que
  // nao existe mais.
  React.useEffect(() => {
    if (!focusTrack || focusTrack.source !== Track.Source.ScreenShare) {
      return;
    }
    const stillThere = screenShareTracks.some((t) => isSameTrackRef(t, focusTrack));
    if (!stillThere) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTrack, screenShareTracks.map((t) => t.publication.trackSid).join()]);

  const otherTracks = tracks.filter((t) => !isSameTrackRef(t, focusTrack));

  const avatarMap = useMembersAvatarMap();

  const screenShareAudioIdentities = useScreenShareAudioIdentities();

  // Largura da faixa de participantes (so existe com foco/transmissao ativa)
  // — arrastavel pelo usuario, persistida em localStorage. Ver pedido no
  // relatorio: "que possam diminuir ou aumentar" a faixa, alem das sidebars.
  const [stripWidth, setStripWidth] = usePersistedSize(
    'concord:participantStripWidth',
    STRIP_DEFAULT_WIDTH,
    STRIP_MIN_WIDTH,
    STRIP_MAX_WIDTH,
  );

  // --- Parar de assistir a transmissao (ROADMAP item 3) -------------------
  //
  // Esconder o tile na UI nao resolve nada: o SFU continua empurrando o video
  // pra ca, gastando a banda de quem nao esta nem olhando (e a de subida da
  // VPS). O que corta os bytes de verdade e `setSubscribed(false)` na
  // publicacao remota — a partir dai o LiveKit para de pedir a track.
  //
  // O AUDIO da transmissao continua assinado de proposito: e uma track
  // separada (Track.Source.ScreenShareAudio), custa pouca banda, e "parei de
  // olhar mas continuo ouvindo o jogo" e util. Quem quiser calar tem o slider
  // proprio no card de volume por participante (ParticipantAudioPanel.tsx).
  //
  // Guardado por `trackSid`: quando a pessoa reinicia a transmissao, o sid e
  // outro e a transmissao volta a entrar DESLIGADA, como qualquer outra nova.
  //
  // O padrao e "nao assistindo": toda transmissao remota entra aqui assim que
  // aparece (ver o efeito logo abaixo). Ninguem e jogado dentro da tela dos
  // outros sem pedir, e a banda so comeca a ser gasta no clique em "Assistir".
  const [unwatchedSids, setUnwatchedSids] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // Ultimo quadro de cada transmissao pausada. Mora AQUI, e nao no tile, porque
  // parar de assistir tira a track do foco e o tile remonta na grade — estado
  // local dele seria perdido no caminho.
  const [pausedFrames, setPausedFrames] = React.useState<Record<string, string>>({});

  // Transmissao remota nova entra desassinada e fora do foco. `seenSidsRef`
  // existe pra isso valer UMA vez por transmissao: sem ele, clicar em
  // "Assistir" tiraria o sid de `unwatchedSids` e este efeito o colocaria de
  // volta no render seguinte — a transmissao nunca ligaria.
  const seenSidsRef = React.useRef<Set<string>>(new Set());
  // Quem esta assistindo AGORA, lido de dentro do `.finally()` da espiada —
  // que roda depois, quando `unwatchedSids` do closure ja pode estar velho.
  const watchingSidsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const novos = screenShareTracks.filter(
      (t) => !t.participant.isLocal && !seenSidsRef.current.has(t.publication.trackSid),
    );
    if (novos.length === 0) {
      return;
    }
    // Marca como "nao assistindo" JA: o tile mostra o convite na hora, sem
    // esperar a espiada abaixo terminar.
    setUnwatchedSids((prev) => {
      const next = new Set(prev);
      for (const t of novos) next.add(t.publication.trackSid);
      return next;
    });
    for (const t of novos) {
      const sid = t.publication.trackSid;
      seenSidsRef.current.add(sid);
      const publication = t.publication as RemoteTrackPublication;
      // Espia UM quadro antes de cortar os bytes, so pra ter o que borrar
      // atras do botao "Assistir" — sem isso o tile de uma transmissao que
      // voce nunca viu e um retangulo liso. O custo esta descrito em
      // lib/peekScreenShareFrame.ts: a assinatura fica de pe pelo tempo de
      // chegar o primeiro quadro, uma vez por transmissao.
      void peekScreenShareFrame(publication)
        .then((frame) => {
          if (frame) {
            setPausedFrames((prev) => (sid in prev ? prev : { ...prev, [sid]: frame }));
          }
        })
        .finally(() => {
          // So corta se a pessoa nao tiver clicado em "Assistir" nesse meio
          // tempo — senao a espiada derrubaria a transmissao que ela acabou
          // de ligar.
          if (!watchingSidsRef.current.has(sid)) {
            publication.setSubscribed(false);
          }
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenShareTracks.map((t) => t.publication.trackSid).join()]);

  const stopWatching = React.useCallback(
    (trackRef: TrackReference, frame: string | null) => {
      const sid = trackRef.publication.trackSid;
      watchingSidsRef.current.delete(sid);
      (trackRef.publication as RemoteTrackPublication).setSubscribed(false);
      setUnwatchedSids((prev) => new Set(prev).add(sid));
      setPausedFrames((prev) => (frame ? { ...prev, [sid]: frame } : prev));
      // Sem isso a transmissao continuaria ocupando a tela inteira mostrando
      // so o quadro congelado. Voltar pra grade e o que o Discord faz.
      if (isSameTrackRef(trackRef, focusTrack)) {
        layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      }
    },
    [focusTrack, layoutContext],
  );

  const startWatching = React.useCallback(
    (trackRef: TrackReference) => {
      const sid = trackRef.publication.trackSid;
      watchingSidsRef.current.add(sid);
      (trackRef.publication as RemoteTrackPublication).setSubscribed(true);
      setUnwatchedSids((prev) => {
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
      setPausedFrames((prev) => {
        const { [sid]: _removed, ...rest } = prev;
        return rest;
      });
      // Clicar em "Assistir" e o UNICO caminho que poe uma transmissao em
      // foco — nao ha mais auto-foco pra fazer isso por voce.
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: trackRef });
    },
    [layoutContext],
  );

  /** `undefined` pra tudo que nao seja transmissao de OUTRA pessoa — a propria
   * tela nao vem pela rede, e camera de terceiro esta fora do escopo. */
  const watchControlFor = React.useCallback(
    (t: TrackReferenceOrPlaceholder): WatchControl | undefined => {
      if (t.source !== Track.Source.ScreenShare || t.participant.isLocal || !isTrackReference(t)) {
        return undefined;
      }
      const sid = t.publication.trackSid;
      return {
        watching: !unwatchedSids.has(sid),
        frame: pausedFrames[sid],
        onStop: (frame) => stopWatching(t, frame),
        onStart: () => startWatching(t),
      };
    },
    [unwatchedSids, pausedFrames, stopWatching, startWatching],
  );

  // Transmissoes REMOTAS que eu estou assistindo agora — a entrada do contador
  // de espectadores. Local nao entra: a propria tela nao se assiste.
  const watchedSids = screenShareTracks
    .filter((t) => !t.participant.isLocal && !unwatchedSids.has(t.publication.trackSid))
    .map((t) => t.publication.trackSid);
  const viewersBySid = useScreenShareViewers(watchedSids);
  /** Numero de espectadores de um tile, ou `undefined` se nao for transmissao. */
  const mixer = useVolumeMixer();
  const audibility = useAudibility();

  /* Som da transmissao em foco, pro botao do teatro. E o MESMO estado do card
     de volume por participante (mixer, fonte `screenShareAudio`): mutar aqui e
     mutar la, e vale so pra mim — quem transmite nao fica sabendo. Ausente
     quando o foco nao e uma transmissao remota: a propria tela ninguem se
     escuta. */
  const focusAudioName =
    focusTrack && focusTrack.source === Track.Source.ScreenShare && !focusTrack.participant.isLocal
      ? focusTrack.participant.name || focusTrack.participant.identity
      : null;
  const theaterAudio = React.useMemo(() => {
    if (!mixer || !focusAudioName) return null;
    return {
      muted: mixer.volumeFor(focusAudioName, 'screenShareAudio') === 0,
      toggle: () => mixer.toggleMute(focusAudioName, 'screenShareAudio'),
    };
  }, [mixer, focusAudioName]);

  const viewersFor = React.useCallback(
    (t: TrackReferenceOrPlaceholder): number | undefined => {
      if (t.source !== Track.Source.ScreenShare || !isTrackReference(t)) {
        return undefined;
      }
      return viewersBySid[t.publication.trackSid];
    },
    [viewersBySid],
  );

  /** O modo foco cala so a voz — o tile de transmissao nunca fica apagado. */
  const isFocusMuted = React.useCallback(
    (t: TrackReferenceOrPlaceholder): boolean => {
      if (t.participant.isLocal || t.source === Track.Source.ScreenShare) {
        return false;
      }
      return mixer?.isFocusMuted(t.participant.name || t.participant.identity) ?? false;
    },
    [mixer],
  );

  const [volumeTarget, setVolumeTarget] = React.useState<{
    participant: RemoteParticipant;
    anchor: { x: number; y: number };
  } | null>(null);

  const handleOpenVolume = React.useCallback(
    (participant: RemoteParticipant, anchor: { x: number; y: number }) => {
      setVolumeTarget({ participant, anchor });
    },
    [],
  );

  // --- Tela cheia ---------------------------------------------------------
  //
  // O estado mora no RoomShell (ver lib/FullscreenContext.tsx) porque a
  // sidebar, que precisa sumir, esta acima deste componente. QUAL track esta
  // em tela cheia continua sendo o `pin` do LayoutContext — a mesma coisa que
  // o auto-foco de screen share ja usava.
  const fullscreen = useFullscreen();
  const theater = fullscreen?.mode === 'theater';
  const stageRef = React.useRef<HTMLDivElement | null>(null);

  const handleExpand = React.useCallback(
    (trackReference: TrackReferenceOrPlaceholder) => {
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference });
      fullscreen?.enterTheater();
    },
    [layoutContext, fullscreen],
  );

  // Controles somem sozinhos no teatro e voltam ao mover o mouse, como num
  // player de video. Fora do teatro nunca escondem.
  const [controlsVisible, setControlsVisible] = React.useState(true);
  React.useEffect(() => {
    if (!theater) {
      setControlsVisible(true);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const reveal = () => {
      setControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setControlsVisible(false), 2500);
    };
    reveal();
    window.addEventListener('pointermove', reveal);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', reveal);
    };
  }, [theater]);

  // Atalhos. Precisam ficar AQUI e nao no <KeyboardShortcuts />: aquele
  // componente e montado fora do LayoutContext e nao enxerga o pin.
  React.useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // `F` e `Esc` nao tem modificador (os atalhos antigos do projeto tem, e
      // por isso nunca precisaram deste guard) — sem isso, digitar "f" no chat
      // jogaria a call em tela cheia.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        fullscreen.toggleTheater();
      } else if (event.key === 'Escape' && fullscreen.mode === 'theater') {
        // Se o fullscreen nativo estiver ativo, o navegador consome o Esc
        // antes de chegar aqui — este caso e so o teatro puro.
        event.preventDefault();
        fullscreen.exit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  return (
    <div
      ref={stageRef}
      className={`lk-video-conference ${styles.stage}`}
      data-fullscreen={theater ? 'true' : undefined}
      data-controls-hidden={theater && !controlsVisible ? 'true' : undefined}
    >
      <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
        <div className={`lk-video-conference-inner ${styles.inner}`}>
          {/* MORA AQUI, E NAO COMO IRMAO DO `.lk-video-conference-inner`:
              o `.lk-video-conference` do LiveKit e `display:flex` em LINHA
              (`align-items:stretch`), entao um <header> solto ali virava uma
              COLUNA a esquerda do palco em vez de uma faixa no topo — foi
              exatamente o que aconteceu. O `-inner` e que e a coluna
              (`flex-direction:column`), e e nele que o cabecalho empilha
              acima da grade e da barra. */}
          {/* Cabecalho do palco (projeto de design): onde voce esta e quanta
              gente tem. */}
          {!theater && (
            <header className={styles.header}>
              <SpeakerIcon size={18} className={styles.headerIcon} />
              <span className={styles.headerTitle}>{room?.name}</span>
              <span className={styles.headerCount}>
                {participants.length === 1 ? '1 na chamada' : `${participants.length} na chamada`}
              </span>
              {/* So o chat fica no topo, encostado na direita — o modo teatro
                  desceu pro canto inferior direito, junto dos controles, que e
                  onde a mao ja esta durante a chamada. */}
              <span className={styles.headerActions}>
                <ChatToggle className={`lk-button ${styles.headerButton}`}>
                  <ChatIcon width={18} height={18} />
                </ChatToggle>
              </span>
            </header>
          )}
          {/* Antes de tudo no palco, impossivel de ignorar. */}
          <FocusModeBanner />
          {focusTrack ? (
            <div className={`lk-focus-layout-wrapper ${styles.focusWrapper}`}>
              <div className={styles.focusMain}>
                <TileErrorBoundary>
                  <CallParticipantTile
                    trackRef={focusTrack}
                    avatarMap={avatarMap}
                    onOpenVolume={handleOpenVolume}
                    onExpand={theater ? undefined : () => handleExpand(focusTrack)}
                    hideActions={theater}
                    watch={watchControlFor(focusTrack)}
                    viewers={viewersFor(focusTrack)}
                    focusMuted={isFocusMuted(focusTrack)}
                    focusRing={audibility[focusTrack.participant.identity]?.ring}
                    mutedMe={audibility[focusTrack.participant.identity]?.mutedMe}
                  />
                </TileErrorBoundary>
              </div>
              {otherTracks.length > 0 && (
                <>
                  {/* Alca entre o video e a faixa — a faixa fica DEPOIS dela
                      (a direita), entao `invert` pra arrastar pra esquerda
                      aumentar o espaco da faixa. Some sozinha em telas
                      estreitas (ver ResizeHandle.module.css). */}
                  <ResizeHandle
                    orientation="vertical"
                    value={stripWidth}
                    min={STRIP_MIN_WIDTH}
                    max={STRIP_MAX_WIDTH}
                    onChange={setStripWidth}
                    invert
                    label="Redimensionar faixa de participantes"
                  />
                  <div className={styles.focusStrip} style={{ width: stripWidth }}>
                    {otherTracks.map((t) => (
                      <TileErrorBoundary key={trackRefKey(t)}>
                        <CallParticipantTile
                          trackRef={t}
                          avatarMap={avatarMap}
                          onOpenVolume={handleOpenVolume}
                          onExpand={() => handleExpand(t)}
                          watch={watchControlFor(t)}
                          viewers={viewersFor(t)}
                          focusMuted={isFocusMuted(t)}
                          focusRing={audibility[t.participant.identity]?.ring}
                          mutedMe={audibility[t.participant.identity]?.mutedMe}
                        />
                      </TileErrorBoundary>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="lk-grid-layout-wrapper">
              <div className={styles.grid} data-count={tracks.length}>
                {tracks.map((t) => (
                  <TileErrorBoundary key={trackRefKey(t)}>
                    <CallParticipantTile
                      trackRef={t}
                      avatarMap={avatarMap}
                      onOpenVolume={handleOpenVolume}
                      onExpand={() => handleExpand(t)}
                      watch={watchControlFor(t)}
                      viewers={viewersFor(t)}
                      focusMuted={isFocusMuted(t)}
                      focusRing={audibility[t.participant.identity]?.ring}
                      mutedMe={audibility[t.participant.identity]?.mutedMe}
                    />
                  </TileErrorBoundary>
                ))}
              </div>
            </div>
          )}
          {theater && fullscreen && (
            /* Unica fileira de botoes do teatro: som da live, etapa 2 e saida.
               O tile nao desenha a dele aqui (`hideActions`) — os dois caiam
               no mesmo canto, um por cima do outro. Fora do teatro o caminho
               continua sendo o botao de expandir do proprio tile. */
            <div className={styles.fullscreenControls}>
              {theaterAudio && (
                <button
                  type="button"
                  className={styles.fullscreenButton}
                  onClick={theaterAudio.toggle}
                  aria-pressed={theaterAudio.muted}
                  aria-label={theaterAudio.muted ? 'Voltar o som da live' : 'Mutar o som da live'}
                  title={
                    theaterAudio.muted
                      ? 'Voltar o som da live'
                      : 'Mutar o som da live — so pra voce'
                  }
                >
                  {theaterAudio.muted ? <VolumeXIcon size={16} /> : <Volume2Icon size={16} />}
                </button>
              )}
              <button
                type="button"
                className={styles.fullscreenButton}
                onClick={() => fullscreen.toggleNative(stageRef.current)}
                aria-label={
                  fullscreen.native ? 'Sair da tela cheia do navegador' : 'Tela cheia do navegador'
                }
                title={
                  fullscreen.native ? 'Sair da tela cheia do navegador' : 'Tela cheia do navegador'
                }
              >
                {fullscreen.native ? <CollapseIcon size={16} /> : <ExpandIcon size={16} />}
              </button>
              <button
                type="button"
                className={styles.fullscreenButton}
                onClick={() => fullscreen.exit()}
                aria-label="Voltar ao layout normal"
                title="Voltar ao layout normal (Esc)"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          )}
          {/* Rodape em tres partes, como num player: a barra ocupa o centro
              da largura toda e as acoes de VISUALIZACAO ficam ancoradas na
              direita. Elas nao entram na pilula de proposito — la sao acoes
              de midia (microfone, camera, tela), aqui e "como eu enxergo". */}
          <div className={styles.footer}>
            <CallControlBar onDeviceError={props.onDeviceError} />
            {!theater && fullscreen && (
              <div className={styles.footerRight}>
                <button
                  type="button"
                  className={styles.headerButton}
                  onClick={() => fullscreen.enterTheater()}
                  aria-label="Modo teatro"
                  title="Modo teatro (F)"
                >
                  <ExpandIcon size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
        <Chat
          style={{ display: widgetState.showChat ? 'grid' : 'none' }}
          messageFormatter={props.chatMessageFormatter}
          messageEncoder={props.chatMessageEncoder}
          messageDecoder={props.chatMessageDecoder}
        />
        {SHOW_SETTINGS_MENU && (
          <div
            className="lk-settings-menu-modal"
            style={{ display: widgetState.showSettings ? 'block' : 'none' }}
          >
            <SettingsMenu />
          </div>
        )}
      </LayoutContextProvider>
      {/* Sem isso ninguem ouve ninguem — ver nota no topo do arquivo. */}
      <RoomAudioRenderer />
      <ConnectionStateToast />
      {volumeTarget && (
        <ParticipantVolumeCard
          participant={volumeTarget.participant}
          hasScreenShareAudio={screenShareAudioIdentities.has(volumeTarget.participant.identity)}
          anchor={volumeTarget.anchor}
          onClose={() => setVolumeTarget(null)}
        />
      )}
    </div>
  );
}
