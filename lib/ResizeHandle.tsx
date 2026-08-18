'use client';

import * as React from 'react';
import styles from '../styles/ResizeHandle.module.css';

export interface ResizeHandleProps {
  /** 'vertical' = barra vertical, redimensiona largura. 'horizontal' = barra horizontal, redimensiona altura. */
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  /**
   * Por padrao o painel redimensionado fica do lado "antes" da alca (esquerda
   * pra vertical, acima pra horizontal) — arrastar pra frente aumenta o
   * tamanho. Quando o painel fica do lado "depois" (caso da faixa de
   * participantes, que fica a DIREITA do video e a alca na borda esquerda
   * dela), passe `invert` pra inverter o sinal.
   */
  invert?: boolean;
  label: string;
  /** Incremento por tecla de seta, em px. */
  step?: number;
}

/**
 * Alca de arraste entre um painel redimensionavel e o resto do layout.
 * Usa Pointer Events (funciona com mouse, touch e caneta com o mesmo
 * handler) em vez de mousedown/mousemove — ver pedido no relatorio. Tambem
 * responde a teclado (setas) com `role="separator"` + `aria-valuenow`,
 * seguindo o padrao WAI-ARIA de "window splitter".
 */
export function ResizeHandle(props: ResizeHandleProps) {
  const { orientation, value, min, max, onChange, invert = false, label, step = 16 } = props;
  const draggingRef = React.useRef<{ startPos: number; startValue: number } | null>(null);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // So o botao primario (ou touch/caneta, que nao reportam `button` !== 0).
      if (event.button !== undefined && event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingRef.current = {
        startPos: orientation === 'vertical' ? event.clientX : event.clientY,
        startValue: value,
      };
    },
    [orientation, value],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = draggingRef.current;
      if (!drag) return;
      const pos = orientation === 'vertical' ? event.clientX : event.clientY;
      const delta = pos - drag.startPos;
      onChange(drag.startValue + (invert ? -delta : delta));
    },
    [orientation, invert, onChange],
  );

  const stopDragging = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const decreaseKey = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      const increaseKey = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      let direction = 0;
      if (event.key === decreaseKey) direction = -1;
      else if (event.key === increaseKey) direction = 1;
      else if (event.key === 'Home') {
        event.preventDefault();
        onChange(min);
        return;
      } else if (event.key === 'End') {
        event.preventDefault();
        onChange(max);
        return;
      } else {
        return;
      }
      event.preventDefault();
      onChange(value + (invert ? -direction : direction) * step);
    },
    [orientation, invert, value, step, min, max, onChange],
  );

  return (
    <div
      className={`${styles.handle} ${orientation === 'vertical' ? styles.vertical : styles.horizontal}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.grip} />
    </div>
  );
}
