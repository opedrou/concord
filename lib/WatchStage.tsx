'use client';

// O que ocupa o lugar do vídeo em foco quando há sessão de assistir junto
// (W2). Existe como componente próprio pra manter o diff do CallStage pequeno:
// lá isso é uma linha dentro do `focusMain` que já existe.
//
// POR QUE NÃO EMPURRAR PELO `pin`/LayoutContext
// ---------------------------------------------
// Um <iframe> não é uma track do LiveKit. Encaixá-lo no `pin` exigiria
// inventar uma track falsa; o que dá pra reusar é o LAYOUT (focusMain grande +
// focusStrip com as câmeras), e é o que o CallStage faz.
//
// As câmeras de todo mundo continuam na faixa ao lado, de propósito: o ponto
// da feature é ver os outros ENQUANTO assiste. Por isso o player não usa o
// padrão de overlay do RoomShell, que esconde a call.

import * as React from 'react';
import { useWatch } from '@/lib/WatchContext';
import { WatchBar } from '@/lib/WatchPanel';
import { YouTubeWatchPlayer } from '@/lib/YouTubeWatchPlayer';
import { JellyfinWatchPlayer } from '@/lib/JellyfinWatchPlayer';
import styles from '../styles/WatchPanel.module.css';

export function WatchStage() {
  const watch = useWatch();
  if (!watch?.source) {
    return null;
  }
  const { source, registerPlayer, reportLiveEdge, reportProblem } = watch;

  // `key` no id: trocar o que está em cartaz tem que derrubar o player e
  // montar outro, não reaproveitar o antigo — mesmo raciocínio do
  // `key={roomName}` do RoomShell.
  return (
    <div className={styles.stage}>
      {source.kind === 'youtube' ? (
        <YouTubeWatchPlayer
          key={source.id}
          videoId={source.id}
          className={styles.player}
          onPlayer={registerPlayer}
          onLiveEdge={reportLiveEdge}
          onProblem={reportProblem}
        />
      ) : (
        <JellyfinWatchPlayer
          key={source.id}
          itemId={source.id}
          className={styles.player}
          onPlayer={registerPlayer}
          onLiveEdge={reportLiveEdge}
          onProblem={reportProblem}
        />
      )}
      <WatchBar />
    </div>
  );
}
