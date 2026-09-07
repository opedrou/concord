'use client';

// O player do YouTube (W4) implementando a interface `WatchPlayer` do W1.
// Não sabe nada de sincronia: só sabe tocar, pausar, buscar e dizer onde está.
// Quem manda nele é o loop de reconciliação do useWatchSync.
//
// SEM CONTROLES NATIVOS (`controls: 0`)
// -------------------------------------
// O relógio do grupo é a verdade, e o loop de reconciliação reaplica
// play/pause a cada segundo. Com a barra do YouTube na tela, arrastar ou
// pausar por ali seria desfeito em ~1s sem explicação nenhuma — a pessoa
// veria o vídeo "lutando" com ela. Os controles moram na barra do Concord
// (WatchBar), onde play/pause/seek viram comando pra sala inteira.
//
// O QUE FOI MEDIDO NUMA LIVE REAL (2026-08-29)
// --------------------------------------------
// - `getDuration()` mente numa live manifestless (reportou 20510 quando a
//   borda era 16930) e só se corrige DEPOIS de um seek. Não serve de borda.
//   Quem está na borda é o `getCurrentTime()` de quem acabou de entrar.
// - Seek pra frente é clampado na borda; `seekTo(1e9)` é um jeito confiável
//   de achá-la, mas interrompe a reprodução — por isso a borda só é lida na
//   ENTRADA, quando o player naturalmente já nasce nela.
// - `progressBarStartPositionUtcTimeMillis` / `...End...` e `isSeekable` vêm
//   `null` mesmo numa live que tocou. Não dá pra usar nada disso como âncora.
// - `onError` 101 e 150 = o dono do vídeo bloqueou o embed. Acontece, e a UI
//   precisa dizer isso em vez de mostrar um quadrado preto.

import * as React from 'react';
import type { WatchPlayer } from './useWatchSync';
import { LIVE_BEHIND_MS } from './watchSync';

/** O pedaço da IFrame API que este arquivo usa. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  getVideoData(): { isLive?: boolean; allowLiveDvr?: boolean } | undefined;
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement | string, options: unknown) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * A IFrame API é um script global e um callback global: carregar duas vezes
 * atropela o `onYouTubeIframeAPIReady` de quem carregou antes. Uma promessa de
 * módulo garante um carregamento só, por mais players que existam.
 */
let apiPromise: Promise<YTNamespace> | null = null;

function loadIframeApi(): Promise<YTNamespace> {
  if (apiPromise) {
    return apiPromise;
  }
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('IFrame API carregou sem YT.Player'));
      }
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => reject(new Error('não deu pra carregar a IFrame API'));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export type WatchPlayerProblem = 'embed-bloqueado' | 'nao-carregou' | 'live-sem-dvr';

export interface YouTubeWatchPlayerProps {
  videoId: string;
  /** Chamado quando o player está pronto (e com `null` quando ele morre). */
  onPlayer: (player: WatchPlayer | null) => void;
  /**
   * Onde a borda ao vivo estava quando este player entrou, em ms — ou `null`
   * se não for uma live. Quem abre a sessão usa isso pra escolher a posição
   * inicial (`liveTargetMs`); quem só entra ignora.
   */
  onLiveEdge?: (edgeMs: number | null) => void;
  onProblem?: (problem: WatchPlayerProblem) => void;
  className?: string;
}

export function YouTubeWatchPlayer({
  videoId,
  onPlayer,
  onLiveEdge,
  onProblem,
  className,
}: YouTubeWatchPlayerProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  // Refs pros callbacks: eles são recriados a cada render do pai, e tê-los nas
  // deps do efeito destruiria e recriaria o player (recarregando o vídeo).
  const onPlayerRef = React.useRef(onPlayer);
  onPlayerRef.current = onPlayer;
  const onLiveEdgeRef = React.useRef(onLiveEdge);
  onLiveEdgeRef.current = onLiveEdge;
  const onProblemRef = React.useRef(onProblem);
  onProblemRef.current = onProblem;

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let player: YTPlayer | null = null;
    let cancelled = false;
    let metadataLido = false;

    void loadIframeApi()
      .then((YT) => {
        if (cancelled) {
          return;
        }
        player = new YT.Player(host, {
          videoId,
          playerVars: {
            enablejsapi: 1,
            // Recomendado pela doc oficial contra sequestro do player por JS
            // de terceiro.
            origin: window.location.origin,
            // Ver o comentário do topo: os controles moram na barra do
            // Concord, senão o loop de sincronia briga com a pessoa.
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              if (cancelled || !player) {
                return;
              }
              onPlayerRef.current(makeWatchPlayer(player));
              // NADA de `getVideoData()` aqui. Medido no navegador: no
              // `onReady` os metadados ainda não chegaram e `isLive` vem
              // `undefined` mesmo numa live — o código caía no ramo "não é
              // live" e abria a sessão em 0, ou seja no COMEÇO da janela de
              // DVR (23070s atrás do ao vivo), o oposto exato do que os 10s
              // existem pra fazer. `getCurrentTime()` também é 0 aqui.
              //
              // Tudo que depende de metadado espera o primeiro PLAYING. Como
              // sem linha do tempo o loop de reconciliação não manda tocar,
              // o empurrão inicial tem que sair daqui.
              player.playVideo();
            },
            onStateChange: (event: { data: number }) => {
              // 1 = PLAYING. Só a primeira vez: daí em diante a posição é a do
              // grupo, não a borda.
              if (cancelled || !player || event.data !== 1 || metadataLido) {
                return;
              }
              metadataLido = true;
              const data = player.getVideoData();
              if (!data?.isLive) {
                onLiveEdgeRef.current?.(null);
                return;
              }
              if (!data.allowLiveDvr) {
                // Sem DVR não há pra onde buscar: os 10s atrás da borda não
                // existem. Avisar é mais honesto que fingir que sincronizou.
                onProblemRef.current?.('live-sem-dvr');
              }
              // Uma live começa a tocar NA borda, então `getCurrentTime()`
              // neste instante É a borda. `getDuration()` não serve (ver topo).
              onLiveEdgeRef.current?.(player.getCurrentTime() * 1000);
            },
            onError: (event: { data: number }) => {
              // 101 e 150 são o mesmo caso: embed bloqueado pelo dono.
              onProblemRef.current?.(
                event.data === 101 || event.data === 150 ? 'embed-bloqueado' : 'nao-carregou',
              );
              onPlayerRef.current(null);
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          onProblemRef.current?.('nao-carregou');
        }
      });

    return () => {
      cancelled = true;
      onPlayerRef.current(null);
      // `destroy` troca o iframe por nada; sem isso, trocar de vídeo deixaria
      // o player velho tocando escondido.
      try {
        player?.destroy();
      } catch {
        // Já destruído junto com o nó do DOM. Nada a fazer.
      }
    };
  }, [videoId]);

  // A IFrame API SUBSTITUI o nó que recebe pelo iframe, então o `div` interno
  // é descartável e o externo é que carrega o layout.
  return (
    <div className={className}>
      <div ref={hostRef} />
    </div>
  );
}

/** Converte a IFrame API na interface que o protocolo espera. */
function makeWatchPlayer(player: YTPlayer): WatchPlayer {
  return {
    positionMs() {
      const seconds = player.getCurrentTime();
      // Antes de começar, `getCurrentTime()` devolve 0 — que é uma posição
      // válida. `getPlayerState() === -1` (não iniciado) é o que distingue
      // "está no começo" de "ainda não sabe".
      if (player.getPlayerState() === -1) {
        return null;
      }
      return Number.isFinite(seconds) ? seconds * 1000 : null;
    },
    seek(positionMs) {
      player.seekTo(positionMs / 1000, true);
    },
    play() {
      player.playVideo();
    },
    pause() {
      player.pauseVideo();
    },
    setRate(rate) {
      // O YouTube só aceita taxas de uma lista fixa; um ajuste fino de 1.03
      // é ignorado em silêncio. Isso NÃO foi medido — se a correção suave não
      // funcionar na prática, é aqui que se descobre.
      player.setPlaybackRate(rate);
    },
  };
}

/** Reexportado pra quem monta a sessão não precisar importar do watchSync. */
export { LIVE_BEHIND_MS };
