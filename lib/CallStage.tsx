'use client';

import * as React from 'react';
import { RemoteParticipant, RoomEvent, Track } from 'livekit-client';
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
import { CallParticipantTile } from '@/lib/CallParticipantTile';
import { TileErrorBoundary } from '@/lib/TileErrorBoundary';
import { ParticipantVolumeCard, useScreenShareAudioIdentities } from '@/lib/ParticipantAudioPanel';
import { useMembersAvatarMap } from '@/lib/useMembersAvatarMap';
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
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const screenShareTracks = tracks.filter(isTrackReference).filter((t) => t.source === Track.Source.ScreenShare);

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
      !screenShareTracks.some((t) => t.publication.trackSid === autoFocusedRef.current?.publication?.trackSid)
    ) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      autoFocusedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenShareTracks.map((t) => `${t.publication.trackSid}_${t.publication.isSubscribed}`).join()]);

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

  return (
    <div className={`lk-video-conference ${styles.stage}`}>
      <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
        <div className={`lk-video-conference-inner ${styles.inner}`}>
          {focusTrack ? (
            <div className={`lk-focus-layout-wrapper ${styles.focusWrapper}`}>
              <div className={styles.focusMain}>
                <TileErrorBoundary>
                  <CallParticipantTile
                    trackRef={focusTrack}
                    avatarMap={avatarMap}
                    onOpenVolume={handleOpenVolume}
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
                    />
                  </TileErrorBoundary>
                ))}
              </div>
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
