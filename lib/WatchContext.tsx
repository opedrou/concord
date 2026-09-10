'use client';

// Dono da sessão de assistir junto: junta o protocolo (useWatchSync), o player
// (quem RENDERIZA é o CallStage, no lugar do vídeo em foco) e a UI que abre e
// controla (WatchPanel, WatchBar).
//
// POR QUE UM CONTEXTO, E NÃO ESTADO DENTRO DO CallStage
// ----------------------------------------------------
// Três lugares distintos precisam da mesma sessão: o botão da barra de
// controle (que abre), o palco (que desenha o player) e a barra do player (que
// dá play/pause). Sem contexto, o estado teria que subir até o PageClientImpl e
// descer por props atravessando componentes que não têm nada com isso. É o
// mesmo motivo — e o mesmo formato — do MicProcessorContext e do
// VolumeMixerContext.
//
// O provider fica DENTRO do RoomContext.Provider, porque useWatchSync usa o
// canal de dados e os atributos da sala.

import * as React from 'react';
import { useWatchSync, type UseWatchSync, type WatchPlayer } from './useWatchSync';
import type { WatchPlayerProblem } from './YouTubeWatchPlayer';
import { liveTargetMs } from './watchSync';
import { decodeWatchSource, encodeWatchSource, type WatchSource } from './watchSource';
import { parseYouTubeId, parseYouTubeStartMs } from './youtubeUrl';

export interface WatchContextValue {
  /** O protocolo. `timeline === null` quer dizer "não há sessão". */
  sync: UseWatchSync;
  /** O que está em cartaz, derivado da linha do tempo do grupo. */
  source: WatchSource | null;
  /** O CallStage chama isto quando o player fica pronto (ou morre). */
  registerPlayer: (player: WatchPlayer | null) => void;
  /**
   * O player DESTE cliente. A WatchBar usa pra legenda, que e local e nao passa
   * pela sincronia — todo o resto (play, pause, seek) tem que ir por `sync`,
   * senao vale so pra quem clicou.
   */
  player: WatchPlayer | null;
  /** O CallStage chama isto na entrada, com a borda ao vivo (ou `null`). */
  reportLiveEdge: (edgeMs: number | null) => void;
  problem: WatchPlayerProblem | null;
  reportProblem: (problem: WatchPlayerProblem | null) => void;
  /**
   * Abre uma sessão com o que a pessoa colou.
   * @returns `false` se não deu pra reconhecer um vídeo do YouTube ali.
   */
  open: (input: string) => boolean;
  /** Abre um item da biblioteca do Jellyfin. */
  openJellyfin: (itemId: string) => void;
}

const WatchContext = React.createContext<WatchContextValue | null>(null);

/** `null` fora do provider — o consumidor decide se isso é problema. */
export function useWatch(): WatchContextValue | null {
  return React.useContext(WatchContext);
}

export function WatchProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = React.useState<WatchPlayer | null>(null);
  const [problem, setProblem] = React.useState<WatchPlayerProblem | null>(null);

  // O que ESTE cliente pediu pra abrir, enquanto o player ainda não existe.
  // Numa live a posição inicial depende da borda, e a borda só aparece quando
  // o player fica pronto — então abrir é um processo de dois tempos.
  const [pending, setPending] = React.useState<{ src: string; startMs: number } | null>(null);

  const sync = useWatchSync(player);
  const { timeline, start } = sync;

  // O que está em cartaz vem da linha do tempo do GRUPO, não do que este
  // cliente pediu: é isso que faz quem chega no meio cair no vídeo certo
  // sozinho.
  const src = timeline?.src || pending?.src || null;
  const source = React.useMemo(() => (src ? decodeWatchSource(src) : null), [src]);

  const open = React.useCallback((input: string) => {
    const id = parseYouTubeId(input);
    if (!id) {
      return false;
    }
    setProblem(null);
    setPending({
      src: encodeWatchSource({ kind: 'youtube', id }),
      startMs: parseYouTubeStartMs(input),
    });
    return true;
  }, []);

  const openJellyfin = React.useCallback((itemId: string) => {
    setProblem(null);
    setPending({ src: encodeWatchSource({ kind: 'jellyfin', id: itemId }), startMs: 0 });
  }, []);

  const reportLiveEdge = React.useCallback(
    (edgeMs: number | null) => {
      // Só quem está abrindo a sessão usa a borda. Quem entrou no meio já tem
      // a posição do grupo e não pode se reposicionar pela própria borda —
      // seria justamente o "cada um onde o buffer dele chegou" que os 10s
      // atrás existem pra evitar.
      setPending((current) => {
        if (!current) {
          return null;
        }
        start(current.src, edgeMs === null ? current.startMs : liveTargetMs(edgeMs));
        return null;
      });
    },
    [start],
  );

  const reportProblem = React.useCallback((next: WatchPlayerProblem | null) => {
    setProblem(next);
  }, []);

  const value = React.useMemo<WatchContextValue>(
    () => ({
      sync,
      source,
      registerPlayer: setPlayer,
      player,
      reportLiveEdge,
      problem,
      reportProblem,
      open,
      openJellyfin,
    }),
    [sync, source, player, reportLiveEdge, problem, reportProblem, open, openJellyfin],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}
