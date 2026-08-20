'use client';

import * as React from 'react';
import { RemoteParticipant, RemoteTrackPublication, RoomEvent, Track } from 'livekit-client';
import type { TrackReference } from '@livekit/components-react';
import {
  Chat,
  ConnectionStateToast,
  isTrackReference,
  LayoutContextProvider,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
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
import { CollapseIcon, ExpandIcon, CloseIcon } from '@/lib/icons';
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
  const autoFocusedRef = React.useRef<TrackReferenceOrPlaceholder | null>(null);

  // Replica o comportamento do <VideoConference>: quando alguém começa a
  // compartilhar tela, foca automaticamente nela; quando para, tira o foco
  // (mas só se o foco ainda for daquela mesma track — se a pessoa pinou outra
  // coisa na mão nesse meio tempo, não mexe).
  React.useEffect(() => {
    const firstSubscribed = screenShareTracks.find((t) => t.publication.isSubscribed);
    if (firstSubscribed && autoFocusedRef.current === null) {
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: firstSubscribed });
      autoFocusedRef.current = firstSubscribed;
    } else if (
      autoFocusedRef.current &&
      !screenShareTracks.some(
        (t) => t.publication.trackSid === autoFocusedRef.current?.publication?.trackSid,
      )
    ) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      autoFocusedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    screenShareTracks.map((t) => `${t.publication.trackSid}_${t.publication.isSubscribed}`).join(),
  ]);

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
  // outro e voce volta a assistir por padrao — que e o esperado.
  const [unwatchedSids, setUnwatchedSids] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // Ultimo quadro de cada transmissao pausada. Mora AQUI, e nao no tile, porque
  // parar de assistir tira a track do foco e o tile remonta na grade — estado
  // local dele seria perdido no caminho.
  const [pausedFrames, setPausedFrames] = React.useState<Record<string, string>>({});

  const stopWatching = React.useCallback(
    (trackRef: TrackReference, frame: string | null) => {
      const sid = trackRef.publication.trackSid;
      (trackRef.publication as RemoteTrackPublication).setSubscribed(false);
      setUnwatchedSids((prev) => new Set(prev).add(sid));
      setPausedFrames((prev) => (frame ? { ...prev, [sid]: frame } : prev));
      // Sem isso a transmissao continuaria ocupando a tela inteira mostrando
      // so o quadro congelado. Voltar pra grade e o que o Discord faz.
      if (isSameTrackRef(trackRef, focusTrack)) {
        layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
        autoFocusedRef.current = null;
      }
    },
    [focusTrack, layoutContext],
  );

  const startWatching = React.useCallback(
    (trackRef: TrackReference) => {
      const sid = trackRef.publication.trackSid;
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
      // O efeito de auto-foco nao repina sozinho (ele so age na PRIMEIRA
      // transmissao que aparece), entao voltar a assistir foca na mao.
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: trackRef });
      autoFocusedRef.current = trackRef;
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
            /* Etapa 2 e saida. So aparece no teatro — fora dele o caminho e o
               botao de expandir do proprio tile. */
            <div className={styles.fullscreenControls}>
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
          <CallControlBar onDeviceError={props.onDeviceError} />
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
