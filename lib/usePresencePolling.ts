'use client';

import * as React from 'react';
import { fetchPresence, type PresenceMap } from '@/lib/api-client';

// Intervalo de polling: rapido o suficiente pra sidebar parecer "viva" (Discord
// atualiza quase em tempo real via websocket), mas sem massacrar o SFU/servidor
// com requisicao HTTP. 4s e um meio-termo razoavel pra 2-5 pessoas.
const POLL_INTERVAL_MS = 4000;

/**
 * Faz polling de GET /api/channels/presence, pausando quando a aba nao esta
 * visivel e evitando requisicoes sobrepostas caso uma demore mais que o intervalo.
 */
export function usePresencePolling() {
  const [presence, setPresence] = React.useState<PresenceMap>({});
  const [error, setError] = React.useState<Error | null>(null);
  const isFetchingRef = React.useRef(false);

  const poll = React.useCallback(async () => {
    if (isFetchingRef.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    isFetchingRef.current = true;
    try {
      const data = await fetchPresence();
      setPresence(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      isFetchingRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Volta a ficar visivel: atualiza na hora em vez de esperar o proximo tick.
        poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [poll]);

  /** Mescla presenca otimista localmente, sem esperar o proximo poll. */
  const applyOptimisticJoin = React.useCallback(
    (channelId: string, participant: { identity: string; name: string }) => {
      setPresence((prev) => {
        const next: PresenceMap = {};
        for (const [id, list] of Object.entries(prev)) {
          // Remove o participante de qualquer outro canal em que aparecesse.
          next[id] = list.filter((p) => p.identity !== participant.identity);
        }
        const current = next[channelId] ?? [];
        if (!current.some((p) => p.identity === participant.identity)) {
          next[channelId] = [...current, participant];
        } else {
          next[channelId] = current;
        }
        return next;
      });
    },
    [],
  );

  return { presence, error, applyOptimisticJoin, refresh: poll };
}
