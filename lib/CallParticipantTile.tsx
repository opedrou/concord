'use client';

import * as React from 'react';
import { RemoteParticipant, Track } from 'livekit-client';
import {
  ConnectionQualityIndicator,
  FocusToggle,
  isTrackReference,
  ParticipantName,
  ScreenShareIcon,
  TrackMutedIndicator,
  useParticipantTile,
  useParticipantTracks,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Avatar } from '@/lib/Avatar';
import { ExpandIcon, EyeIcon, EyeOffIcon, VolumeXIcon } from '@/lib/icons';
import { useSpeakingIndicator } from '@/lib/useSpeakingIndicator';
import type { FocusRing } from '@/lib/audibility';
import styles from '../styles/CallParticipantTile.module.css';

/**
 * Tile de participante proprio, no lugar do `<ParticipantTile>` padrao do
 * @livekit/components-react. Dois motivos pra existir (ambos batem na mesma
 * decisao de arquitetura — compor a chamada na mao em vez de usar
 * `<VideoConference>`, ver relatorio):
 *
 * 1. Placeholder de foto de perfil: com a camera desligada, o padrao mostra
 *    um icone generico de silhueta. `ParticipantTileProps` nao tem slot pra
 *    trocar isso — o SVG vem embutido no componente. Aqui a gente monta o
 *    tile a mao com `useParticipantTile` (o mesmo hook que o componente
 *    padrao usa por baixo, entao os data-attributes/classes que o CSS do
 *    LiveKit espera continuam batendo) e desenha o <Avatar/> real no lugar.
 * 2. Clique abre volume: reaproveitamos o onClick nativo (que o hook publico
 *    `onParticipantClick` NAO expoe com coordenadas) pra abrir o card de
 *    volume por participante ancorado perto de onde a pessoa clicou.
 * 3. Parar de assistir a transmissao (ver a prop `watch`): o tile continua na
 *    tela, mas mostrando o ultimo quadro congelado e borrado em vez de video
 *    ao vivo.
 */
/**
 * Controle de "estou assistindo esta transmissao?". So chega preenchido pros
 * screen shares REMOTOS — a propria tela nao consome banda de download, e
 * camera de terceiro nao entra no escopo (ver ROADMAP, item 3).
 */
export interface WatchControl {
  watching: boolean;
  /** Ultimo quadro (data URL) capturado antes de parar de assistir, se deu. */
  frame?: string;
  /** Recebe o quadro capturado pelo tile — quem guarda e o CallStage, porque
   * este componente desmonta ao sair do foco pra grade. */
  onStop: (frame: string | null) => void;
  onStart: () => void;
}

export function CallParticipantTile(props: {
  trackRef: TrackReferenceOrPlaceholder;
  avatarMap: Record<string, string | null>;
  onOpenVolume: (participant: RemoteParticipant, anchor: { x: number; y: number }) => void;
  /** Coloca ESTA transmissao em tela cheia. Ausente = sem botao (ex.: o tile
   * que ja esta em tela cheia nao precisa oferecer o proprio botao). */
  onExpand?: () => void;
  /** Ausente = nao ha o que assistir/parar de assistir neste tile. */
  watch?: WatchControl;
  /** Quantas pessoas estao vendo ESTA transmissao. Ausente fora de screen
   * share, ou quando o dado nao pode ser obtido (ver useScreenShareViewers). */
  viewers?: number;
  /** O modo foco esta calando a voz desta pessoa (so pra mim). */
  focusMuted?: boolean;
  /** ESTA pessoa esta em modo foco — e se eu continuo sendo ouvido por ela.
   * Ver lib/focusBroadcast.ts. */
  focusRing?: FocusRing;
  /** Esta pessoa mutou VOCE individualmente — vale fora do modo foco. */
  mutedMe?: boolean;
}) {
  const {
    trackRef,
    avatarMap,
    onOpenVolume,
    onExpand,
    watch,
    viewers,
    focusMuted,
    focusRing,
    mutedMe,
  } = props;
  const isCameraSource = trackRef.source === Track.Source.Camera;
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // TRANSMISSAO: clicar no tile pequeno amplia, nao abre som. Card de
      // volume no meio da tela nao e o que se espera de um clique num video —
      // e o volume da transmissao continua alcancavel pelo tile de CAMERA da
      // mesma pessoa, que tem o slider "transmissao" no mesmo card do mic
      // (ver ParticipantAudioPanel). Se ainda nao estou assistindo, o clique
      // faz a coisa obvia: comeca a assistir (ampliar um quadro congelado nao
      // serviria pra nada).
      if (trackRef.source === Track.Source.ScreenShare) {
        if (watch && !watch.watching) {
          watch.onStart();
        } else {
          onExpand?.();
        }
        return;
      }
      // So participante remoto tem volume ajustavel — o proprio microfone se
      // controla pela ControlBar, nao clicando no proprio tile.
      if (trackRef.participant.isLocal) return;
      onOpenVolume(trackRef.participant as RemoteParticipant, {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [trackRef.participant, trackRef.source, onOpenVolume, onExpand, watch],
  );

  const { elementProps } = useParticipantTile<HTMLDivElement>({
    trackRef,
    htmlProps: { onClick: handleClick },
  });

  // O `data-lk-speaking` que o useParticipantTile devolve vem do
  // RoomEvent.ActiveSpeakersChanged, ou seja, e o SERVIDOR quem decide quem
  // esta falando: o audio sobe pro SFU, ele mede o nivel, agrega em intervalos
  // e transmite de volta. Isso e uma volta de rede inteira ate a VPS so pra
  // acender uma borda — era o lag que se via na pratica.
  //
  // O useSpeakingIndicator mede o nivel direto da track via Web Audio API,
  // localmente: o audio ja chegou nesta maquina antes de qualquer evento do
  // servidor. Sobrescrevemos o atributo (o CSS do LiveKit continua sendo quem
  // desenha a borda, so trocamos a fonte do dado). Se o caminho local falhar,
  // o proprio hook cai no isSpeaking do servidor — nunca fica sem indicador.
  const micTracks = useParticipantTracks([Track.Source.Microphone], trackRef.participant.identity);
  const { isSpeaking, source: speakingSource } = useSpeakingIndicator(
    trackRef.participant,
    micTracks[0],
  );

  // `watch` presente e desligado => a track esta com `setSubscribed(false)`, o
  // SFU parou de mandar bytes e `publication.track` e undefined. Renderizar o
  // <VideoTrack> ai daria um <video> preto por cima do quadro congelado.
  const stoppedWatching = !!watch && !watch.watching;
  // Mute individual e modo foco tem causas diferentes mas a MESMA consequencia
  // pra quem olha: essa pessoa nao esta te ouvindo. Um distintivo so, com o
  // motivo no tooltip — dois icones dizendo a mesma coisa seria ruido.
  const notHearingMe = !!mutedMe || focusRing === 'excluded';
  const notHearingLabel = mutedMe
    ? 'Não está te ouvindo — mutou você'
    : 'Não está te ouvindo — modo foco ligado';

  const hasLiveVideo =
    !stoppedWatching &&
    isTrackReference(trackRef) &&
    trackRef.publication.kind === Track.Kind.Video;

  // Congela o quadro atual ANTES de dar unsubscribe — depois do unsubscribe o
  // <video> ja esta vazio e nao ha mais o que capturar. Sai reduzido e em JPEG
  // de qualidade baixa de proposito: vai aparecer borrado, ninguem vai ler
  // pixel nenhum ali, e isso e um data URL vivendo em memoria.
  const handleStopWatching = React.useCallback(() => {
    const video = containerRef.current?.querySelector('video');
    watch?.onStop(video ? captureFrame(video) : null);
  }, [watch]);
  const avatarUrl = avatarMap[trackRef.participant.name || trackRef.participant.identity];

  return (
    <div
      {...elementProps}
      ref={containerRef}
      // Depois do spread, de proposito: sobrescreve o valor vindo do servidor.
      data-lk-speaking={isSpeaking}
      // So diagnostico (nao afeta CSS nenhum) — 'local-volume' ou
      // 'server-events', ver useSpeakingIndicator.ts. Da pra inspecionar num
      // devtools durante uma call de verdade e confirmar qual fonte esta
      // ativa por participante, sem precisar instrumentar nada na hora.
      data-lk-speaking-source={speakingSource}
      // Apaga o tile de quem o modo foco silenciou — sem isso a pessoa fala,
      // o anel de "falando" nem acende, e parece bug em vez de escolha.
      data-lk-focus-muted={focusMuted ? 'true' : undefined}
      // Anel roxo: 'listening' = esta em foco e AINDA me ouve; 'excluded' =
      // esta em foco e nao me ouve. Desenhado num ::before proprio pra conviver
      // com o anel de "falando" da lib, que usa ::after.
      data-concord-focus={focusRing}
      className={`${elementProps.className ?? ''} ${styles.tile} ${
        focusMuted ? styles.focusMuted : ''
      }`}
    >
      {hasLiveVideo && <VideoTrack trackRef={trackRef} />}
      {stoppedWatching && (
        <div className={styles.pausedLayer}>
          {watch?.frame ? (
            <div
              className={styles.pausedFrame}
              style={{ backgroundImage: `url(${watch.frame})` }}
              aria-hidden="true"
            />
          ) : (
            <div className={styles.pausedFrame} aria-hidden="true" />
          )}
          <div className={styles.watchPrompt}>
            {/* Sem quadro congelado = transmissao que voce nunca assistiu (ela
                chega desligada). Um retangulo cinza com um botao azul no meio
                nao diz de quem e nem o que aconteceu — o rotulo diz. Depois de
                ja ter assistido, o quadro borrado ao fundo ja conta a
                historia e o rotulo so poluiria. */}
            {!watch?.frame && (
              <span className={styles.watchPromptLabel}>
                {trackRef.participant.name || trackRef.participant.identity} está transmitindo
              </span>
            )}
            <button
              type="button"
              className={styles.watchButton}
              onClick={(event) => {
                event.stopPropagation();
                watch?.onStart();
              }}
            >
              <EyeIcon size={16} />
              Assistir
            </button>
          </div>
        </div>
      )}
      {/* A classe 'lk-participant-placeholder' e a mesma do LiveKit — o CSS
          dele ja controla a visibilidade (so aparece com
          data-lk-video-muted="true" e data-lk-source="camera", nunca no
          screen share), a gente so troca o conteudo: SVG generico -> foto
          real (ou iniciais, se a pessoa nao tiver foto — ver Avatar.tsx). */}
      <div className={`lk-participant-placeholder ${styles.placeholder}`}>
        <Avatar
          username={trackRef.participant.name || trackRef.participant.identity}
          avatarUrl={avatarUrl}
          size={96}
        />
      </div>
      <div className="lk-participant-metadata">
        <div className="lk-participant-metadata-item">
          {isCameraSource ? (
            <TrackMutedIndicator
              trackRef={{ participant: trackRef.participant, source: Track.Source.Microphone }}
              show="muted"
            />
          ) : (
            <ScreenShareIcon style={{ marginRight: '0.25rem' }} />
          )}
          <ParticipantName participant={trackRef.participant} />
          {!isCameraSource && <span>&apos;s screen</span>}
          {/* Contador de espectadores, ao lado do nome da transmissao. So
              aparece com pelo menos uma pessoa vendo — "0 assistindo" nao
              informa nada e ainda ocuparia espaco. */}
          {!isCameraSource && viewers !== undefined && viewers > 0 && (
            <span
              className={styles.viewerCount}
              title={viewers === 1 ? '1 pessoa assistindo' : `${viewers} pessoas assistindo`}
            >
              <EyeIcon size={13} />
              {viewers}
            </span>
          )}
          {/* "Nao te ouve". Icone de ALTO-FALANTE cortado, nao de microfone:
              microfone cortado ja significa outra coisa no tile (a pessoa esta
              muda). Aqui o mic dela pode estar aberto — o que nao acontece e a
              SUA voz chegar nela. */}
          {isCameraSource && notHearingMe && (
            <span
              className={styles.notHearingBadge}
              role="img"
              aria-label={notHearingLabel}
              title={notHearingLabel}
            >
              <VolumeXIcon size={13} />
            </span>
          )}
        </div>
        <ConnectionQualityIndicator
          className="lk-participant-metadata-item"
          participant={trackRef.participant}
        />
      </div>
      <FocusToggle trackRef={trackRef} />
      {watch?.watching && (
        <button
          type="button"
          className={styles.stopWatchButton}
          // Mesmo motivo do botao de expandir: o tile inteiro tem onClick.
          onClick={(event) => {
            event.stopPropagation();
            handleStopWatching();
          }}
          aria-label="Parar de assistir"
          title="Parar de assistir — para de consumir banda"
        >
          <EyeOffIcon size={16} />
        </button>
      )}
      {onExpand && (
        <button
          type="button"
          className={styles.expandButton}
          // OBRIGATORIO: o tile inteiro tem onClick (abre o card de volume por
          // participante). Sem isso, expandir abriria o card junto.
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
          aria-label="Ver em tela cheia"
          title="Ver em tela cheia"
        >
          <ExpandIcon size={16} />
        </button>
      )}
    </div>
  );
}

/**
 * Ultimo quadro do video como data URL, pra virar o "congelado e borrado" de
 * quem parou de assistir — mesma ideia do Discord. `null` quando o navegador
 * ainda nao tem quadro nenhum (`videoWidth === 0`) ou o canvas 2d falha.
 */
function captureFrame(video: HTMLVideoElement): string | null {
  if (!video.videoWidth || !video.videoHeight) {
    return null;
  }
  const scale = Math.min(1, 480 / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    // Canvas "tainted" nao acontece com MediaStream do WebRTC, mas se algum
    // navegador decidir o contrario o certo e ficar sem o quadro, nao quebrar
    // o tile inteiro.
    return null;
  }
}
