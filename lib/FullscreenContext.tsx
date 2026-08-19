'use client';

// Modo tela cheia da transmissao, em DUAS etapas — como no YouTube:
//
//   'off'      layout normal
//   'theater'  a transmissao em foco ocupa a janela inteira: sidebar, alcas,
//              faixa de participantes e barra de controles somem. Ainda dentro
//              da aba, com a moldura do navegador visivel.
//   + native   por cima do teatro, a Fullscreen API do navegador tira tambem a
//              moldura. Sair pelo Esc do navegador volta pro teatro, nao pro
//              layout normal — sao dois niveis independentes.
//
// O provider mora no `RoomShell` porque quem precisa sumir no teatro (a
// `ChannelSidebar` e a alca dela) esta ACIMA do `PageClientImpl`. O estado nao
// podia viver dentro do `CallStage`.
//
// O que NAO esta aqui: qual track esta em tela cheia. Isso continua sendo o
// `pin` do `LayoutContext` que o `CallStage` ja usava pro auto-foco de screen
// share — duplicar seria criar duas fontes de verdade pro mesmo conceito.

import * as React from 'react';

export type FullscreenMode = 'off' | 'theater';

export interface FullscreenValue {
  mode: FullscreenMode;
  /** Fullscreen real do navegador ativo agora. */
  native: boolean;
  enterTheater: () => void;
  /** Sai de tudo: fullscreen nativo (se ativo) e teatro. */
  exit: () => void;
  toggleTheater: () => void;
  /** Liga/desliga a Fullscreen API no elemento dado. */
  toggleNative: (element: HTMLElement | null) => void;
}

const FullscreenContext = React.createContext<FullscreenValue | null>(null);

export function FullscreenProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<FullscreenMode>('off');
  const [native, setNative] = React.useState(false);

  // O navegador tem o proprio caminho de saida (Esc, F11, o botao dele). Sem
  // escutar isso, o estado do React ficaria dizendo "nativo" depois que o
  // usuario ja saiu — e o proximo clique no botao nao faria nada.
  React.useEffect(() => {
    const sync = () => setNative(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const enterTheater = React.useCallback(() => setMode('theater'), []);

  const exit = React.useCallback(() => {
    if (document.fullscreenElement) {
      // Pode rejeitar se ja saiu por outro caminho — nao ha o que fazer com o
      // erro, e o listener de fullscreenchange corrige o estado de qualquer
      // jeito.
      document.exitFullscreen().catch(() => {});
    }
    setMode('off');
  }, []);

  const toggleTheater = React.useCallback(() => {
    setMode((current) => (current === 'theater' ? 'off' : 'theater'));
  }, []);

  const toggleNative = React.useCallback((element: HTMLElement | null) => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    // `requestFullscreen` exige gesto do usuario; se for chamado fora de um, o
    // navegador rejeita e nao ha fallback possivel — o teatro ja cobre o caso.
    element?.requestFullscreen?.().catch(() => {});
  }, []);

  const value = React.useMemo<FullscreenValue>(
    () => ({ mode, native, enterTheater, exit, toggleTheater, toggleNative }),
    [mode, native, enterTheater, exit, toggleTheater, toggleNative],
  );

  return <FullscreenContext.Provider value={value}>{children}</FullscreenContext.Provider>;
}

/** `null` fora do provider. Quem consome deve degradar pra "sem tela cheia". */
export function useFullscreen(): FullscreenValue | null {
  return React.useContext(FullscreenContext);
}
