'use client';

import * as React from 'react';

/**
 * Segura a tela ligada enquanto a chamada esta de pe, e declara a aba como
 * sessao de midia ativa.
 *
 * O PROBLEMA: no celular, a call caia quando a tela apagava. Sao duas coisas
 * diferentes acontecendo:
 *
 * 1. A tela apaga sozinha por inatividade — ninguem toca no aparelho durante
 *    uma call de voz. `navigator.wakeLock` resolve este caso inteiro.
 * 2. A pessoa BLOQUEIA o aparelho. Ai o wake lock e revogado pelo sistema e o
 *    Chrome pode congelar a aba em segundo plano. O que segura a aba viva e
 *    ela ser uma sessao de midia: `navigator.mediaSession` com
 *    `playbackState = 'playing'` marca isso pro Android (e coloca o card de
 *    controle na notificacao, de graca).
 *
 * O que este hook NAO faz: nada aqui garante o caso 2 em toda combinacao de
 * navegador e sistema — em iOS o WebRTC em background e limitado pelo proprio
 * Safari e nao ha API que contorne. Wake lock (caso 1) e determinstico;
 * mediaSession (caso 2) e a melhor ajuda que a plataforma da.
 *
 * O lock cai sozinho toda vez que a aba sai de vista, entao o
 * `visibilitychange` pede de novo ao voltar — sem isso, uma unica ida ao
 * segundo plano deixaria a tela livre pra apagar pelo resto da chamada.
 */
export function useKeepAwake(enabled: boolean, title?: string) {
  React.useEffect(() => {
    if (!enabled) return;

    // `wakeLock` nao existe em contexto inseguro nem em Safari antigo.
    const wakeLockApi = (
      navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } }
    ).wakeLock;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (!wakeLockApi || cancelled || document.visibilityState !== 'visible') return;
      try {
        sentinel = await wakeLockApi.request('screen');
      } catch {
        // Negado (bateria fraca, politica do sistema) nao e erro nosso: a
        // chamada continua funcionando, so a tela volta a apagar sozinha.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    const mediaSession = navigator.mediaSession;
    if (mediaSession) {
      if (window.MediaMetadata) {
        mediaSession.metadata = new window.MediaMetadata({
          title: title ? `Chamada em ${title}` : 'Chamada de voz',
          artist: 'Concord',
        });
      }
      mediaSession.playbackState = 'playing';
    }

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      if (mediaSession) {
        mediaSession.playbackState = 'none';
        mediaSession.metadata = null;
      }
    };
  }, [enabled, title]);
}
