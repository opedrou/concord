'use client';

import * as React from 'react';

/**
 * Error boundary minima em volta de cada tile de participante.
 *
 * Motivo concreto: o `useSpeakingIndicator` usa o `useTrackVolume` da lib, e
 * o `createAudioAnalyser` por baixo dele faz `throw` SINCRONO dentro do
 * proprio useEffect se `new AudioContext()` falhar (limite de contextos
 * simultaneos em alguns navegadores — plausivel com 5 participantes, cada um
 * com seu analisador). Erro lancado dentro de efeito nao e capturavel por
 * try/catch de fora: ele sobe pra Error Boundary mais proxima e, sem uma,
 * derruba a arvore inteira.
 *
 * Ou seja: sem isso, um indicador de fala falhando poderia tirar a pessoa da
 * chamada. Aqui o pior caso vira "um tile some", nao "a call cai".
 */
interface Props {
  children: React.ReactNode;
  /** Renderizado no lugar do tile quando ele quebra. */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class TileErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Nao usamos toast/alert: um tile quebrado nao deve interromper a call de
    // quem esta falando. Fica no console pra diagnostico.
    console.error('[CallParticipantTile] tile quebrou e foi isolado:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
