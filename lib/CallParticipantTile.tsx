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
import { useSpeakingIndicator } from '@/lib/useSpeakingIndicator';
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
 */
export function CallParticipantTile(props: {
  trackRef: TrackReferenceOrPlaceholder;
  avatarMap: Record<string, string | null>;
  onOpenVolume: (participant: RemoteParticipant, anchor: { x: number; y: number }) => void;
}) {
  const { trackRef, avatarMap, onOpenVolume } = props;
  const isCameraSource = trackRef.source === Track.Source.Camera;

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // So participante remoto tem volume ajustavel — o proprio microfone se
      // controla pela ControlBar, nao clicando no proprio tile.
      if (trackRef.participant.isLocal) return;
      onOpenVolume(trackRef.participant as RemoteParticipant, {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [trackRef.participant, onOpenVolume],
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
  const micTracks = useParticipantTracks(
    [Track.Source.Microphone],
    trackRef.participant.identity,
  );
  const { isSpeaking, source: speakingSource } = useSpeakingIndicator(
    trackRef.participant,
    micTracks[0],
  );

  const hasLiveVideo = isTrackReference(trackRef) && trackRef.publication.kind === Track.Kind.Video;
  const avatarUrl = avatarMap[trackRef.participant.name || trackRef.participant.identity];

  return (
    <div
      {...elementProps}
      // Depois do spread, de proposito: sobrescreve o valor vindo do servidor.
      data-lk-speaking={isSpeaking}
      // So diagnostico (nao afeta CSS nenhum) — 'local-volume' ou
      // 'server-events', ver useSpeakingIndicator.ts. Da pra inspecionar num
      // devtools durante uma call de verdade e confirmar qual fonte esta
      // ativa por participante, sem precisar instrumentar nada na hora.
      data-lk-speaking-source={speakingSource}
      className={`${elementProps.className ?? ''} ${styles.tile}`}
    >
      {hasLiveVideo && <VideoTrack trackRef={trackRef} />}
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
        </div>
        <ConnectionQualityIndicator
          className="lk-participant-metadata-item"
          participant={trackRef.participant}
        />
      </div>
      <FocusToggle trackRef={trackRef} />
    </div>
  );
}
