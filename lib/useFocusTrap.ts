'use client';

import * as React from 'react';

/**
 * Prende o foco do teclado dentro de um diálogo enquanto ele está aberto e
 * devolve pra quem o abriu quando fecha.
 *
 * Os diálogos do app já tinham `role="dialog"` e `aria-modal="true"`, mas os
 * dois são só uma PROMESSA feita ao leitor de tela: nenhum navegador restringe
 * o Tab por causa deles. Sem isto, tabular a partir da janela de configurações
 * andava pela sidebar e pelos controles da call que estão atrás — quem navega
 * por teclado saía do diálogo sem perceber e continuava clicando em coisa que
 * não via, porque o backdrop cobre tudo visualmente.
 *
 * Não usa `<dialog>` nativo (que faria isso de graça) porque a janela é
 * renderizada num portal com backdrop próprio e um `showModal()` traria o
 * `::backdrop` e a pilha de camadas do navegador junto — trocaria três telas de
 * CSS que já funcionam por um problema novo de empilhamento dentro de uma call.
 *
 * @param active enquanto `false`, não faz nada (o diálogo está fechado).
 * @param externalRef ref que o componente já mantém no mesmo elemento (o card
 *   de volume usa um pra detectar clique fora). Sem isto seriam dois refs
 *   disputando o mesmo nó.
 * @returns ref pra pendurar no container do diálogo.
 */
export function useFocusTrap(
  active: boolean,
  externalRef?: React.MutableRefObject<HTMLDivElement | null>,
) {
  const ownRef = React.useRef<HTMLDivElement | null>(null);
  const ref = externalRef ?? ownRef;

  React.useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    // Quem tinha o foco antes de abrir — pra devolver no fim.
    const previous = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
        // `offsetParent === null` derruba o que está com display:none. Um
        // diálogo com abas (as configurações) tem os painéis inativos no DOM.
      ).filter((el) => el.offsetParent !== null);

    // Foco inicial no primeiro controle. Sem isto o foco continuava no corpo da
    // página atrás e o primeiro Tab caía fora do diálogo.
    const first = focusable()[0];
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      // Só as duas pontas precisam de intervenção: no meio, o Tab do navegador
      // já anda certo sozinho.
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // `isConnected`: se o elemento que abriu o diálogo saiu do DOM junto (um
      // botão dentro de um tile que sumiu), devolver o foco pra ele jogaria o
      // foco no <body> — pior que deixar onde está.
      if (previous?.isConnected) previous.focus();
    };
  }, [active, ref]);

  return ref;
}
