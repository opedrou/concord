'use client';

// O player do Jellyfin (W3) implementando a mesma interface `WatchPlayer` do
// W1 que o YouTube implementa. É um `<video>` normal apontando pro nosso
// proxy — a credencial do Jellyfin nunca chega aqui (ver lib/jellyfin.ts).
//
// Bem mais simples que o do YouTube: um elemento de mídia nativo já tem
// `currentTime`, `play()`, `pause()` e `playbackRate`, e o `playbackRate`
// aceita QUALQUER número — então a correção suave de drift funciona aqui, ao
// contrário do YouTube, cujo `setPlaybackRate` só aceita uma lista fixa.
//
// `controls={false}` pelo mesmo motivo do YouTube: os controles moram na barra
// do Concord, senão o loop de sincronia briga com quem arrasta a barra nativa.
//
// NÃO TESTADO CONTRA UM JELLYFIN DE VERDADE. O seek depende de o proxy
// devolver 206 com Content-Range, que depende de o Jellyfin responder Range no
// endpoint de vídeo — o teste do spike W0 que nunca foi feito.

import * as React from 'react';
import type { WatchPlayer } from './useWatchSync';

export interface JellyfinWatchPlayerProps {
  itemId: string;
  onPlayer: (player: WatchPlayer | null) => void;
  /**
   * Sempre `null` — arquivo do Jellyfin nunca é ao vivo. Existe porque é o
   * sinal de "player pronto" que o WatchContext espera pra abrir a sessão; o
   * player do YouTube usa o mesmo caminho, só que com a borda ao vivo dentro.
   */
  onLiveEdge?: (edgeMs: null) => void;
  onProblem?: (problem: 'nao-carregou') => void;
  className?: string;
}

export function JellyfinWatchPlayer({
  itemId,
  onPlayer,
  onLiveEdge,
  onProblem,
  className,
}: JellyfinWatchPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const onPlayerRef = React.useRef(onPlayer);
  onPlayerRef.current = onPlayer;
  const onLiveEdgeRef = React.useRef(onLiveEdge);
  onLiveEdgeRef.current = onLiveEdge;
  const onProblemRef = React.useRef(onProblem);
  onProblemRef.current = onProblem;

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const player: WatchPlayer = {
      positionMs() {
        // `readyState 0` = nada carregado ainda; `currentTime` seria 0, que é
        // uma posição válida e enganaria o loop de drift.
        return video.readyState === 0 ? null : video.currentTime * 1000;
      },
      seek(positionMs) {
        video.currentTime = positionMs / 1000;
      },
      play() {
        // O autoplay pode ser recusado (quem chega no meio não deu gesto
        // nenhum). Engolir a rejeição: o loop de reconciliação tenta de novo a
        // cada segundo, e assim que houver um clique na página ela pega.
        void video.play().catch(() => {});
      },
      pause() {
        video.pause();
      },
      setRate(rate) {
        video.playbackRate = rate;
      },
    };

    onPlayerRef.current(player);
    onLiveEdgeRef.current?.(null);
    const onError = () => onProblemRef.current?.('nao-carregou');
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('error', onError);
      onPlayerRef.current(null);
    };
  }, [itemId]);

  return (
    <video
      ref={videoRef}
      className={className}
      src={`/api/jellyfin/stream/${itemId}`}
      // `metadata` e não `auto`: quem entra numa sessão que já rola vai dar
      // seek pra posição do grupo em seguida, então baixar do começo é banda
      // jogada fora.
      preload="metadata"
      playsInline
      controls={false}
    />
  );
}
