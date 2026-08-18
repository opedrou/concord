'use client';

import * as React from 'react';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Tamanho (largura ou altura, em px) de um painel redimensionavel, com
 * persistencia em `localStorage`. Usado pela sidebar de canais e pela faixa
 * de participantes na tela de call — cada uma com sua propria `key`.
 *
 * SSR-safe de proposito: o primeiro render sempre usa `defaultSize` (mesmo
 * valor no server e no client), e o valor gravado so e lido dentro de um
 * `useEffect` — evita hydration mismatch por causa de um localStorage que o
 * servidor nunca teve acesso.
 */
export function usePersistedSize(
  key: string,
  defaultSize: number,
  min: number,
  max: number,
): [number, (next: number | ((prev: number) => number)) => void] {
  const [size, setSizeState] = React.useState(defaultSize);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          setSizeState(clamp(parsed, min, max));
        }
      }
    } catch {
      // localStorage indisponivel (modo privado, quota etc) — segue com o default.
    }
    // Só na montagem: nao queremos reler o localStorage sempre que min/max mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setSize = React.useCallback(
    (next: number | ((prev: number) => number)) => {
      setSizeState((prev) => {
        const raw = typeof next === 'function' ? (next as (p: number) => number)(prev) : next;
        const clamped = clamp(raw, min, max);
        try {
          window.localStorage.setItem(key, String(clamped));
        } catch {
          // idem — perde so a persistencia, a UI continua funcionando.
        }
        return clamped;
      });
    },
    [key, min, max],
  );

  return [size, setSize];
}
