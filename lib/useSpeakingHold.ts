'use client';

import * as React from 'react';

// ---------------------------------------------------------------------------
// Por que esse hook existe separado do useSpeakingIndicator
// ---------------------------------------------------------------------------
//
// `useSpeakingIndicator.ts` resolve um problema diferente: ele tem um NIVEL
// continuo (0..1, via Web Audio) e por isso faz histerese de verdade — limiar
// de subida > limiar de descida, com uma zona ambigua no meio onde nao faz
// nada. Esse hook aqui recebe só um BOOLEANO (ex: `room.activeSpeakers`,
// agregado no servidor — ver CallStateBinder.tsx) — não há nível pra comparar
// contra dois limiares, então "histerese" nesse sentido não se aplica. A
// única peça que sobra, e que é genuinamente reutilizavel, e o HOLD: acende na hora
// quando o booleano vira `true`, e so apaga depois de `holdMs` continuos em
// `false`, sem reagendar um timer ja em andamento. Extrair só isso pra cá (em
// vez de tentar consumir o `useSpeakingIndicator` inteiro, ou de generalizar
// aquele hook pra aceitar booleano) evita tanto misturar os dois algoritmos
// quanto inventar uma abstração de "histerese genérica" que o segundo
// chamador não precisa — ver PLANO-2.md, item R5.
//
// Este arquivo NÃO importa nada de Web Audio, `livekit-client` ou
// `@livekit/components-react` de proposito — e o unico jeito de garantir que
// ele continue reutilizavel por qualquer sinal booleano, nao so por
// participante numa call.

/**
 * Segura um booleano "aceso" por `holdMs` depois que ele vira `false`, pra
 * absorver flutuações rápidas (ex: pausas curtas entre palavras) sem piscar.
 * Acende IMEDIATAMENTE quando `active` vira `true` — só o apagar é
 * atrasado.
 *
 * @param active Sinal bruto (ex: `speaking` cru vindo do servidor).
 * @param holdMs Quanto tempo `active === false` precisa persistir antes do
 *   valor retornado virar `false`. Um timer já agendado não é reagendado por
 *   novas flutuações — o hold conta a partir da PRIMEIRA vez que `active`
 *   caiu, não fica sendo empurrado pra frente.
 */
export function useSpeakingHold(active: boolean, holdMs: number): boolean {
  const [held, setHeld] = React.useState(active);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (active) {
      // Acende na hora e cancela qualquer apagar já agendado.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setHeld(true);
      return;
    }

    // Já agendado? não reagenda — o hold conta a partir da PRIMEIRA vez que
    // `active` caiu, não fica sendo empurrado pra frente por flutuações
    // dentro da própria janela de hold (mesmo cuidado do
    // useSpeakingIndicator.ts).
    setHeld((current) => {
      if (current && timerRef.current === null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setHeld(false);
        }, holdMs);
      }
      return current;
    });
  }, [active, holdMs]);

  // Limpeza do timer no unmount.
  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return held;
}
