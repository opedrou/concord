'use client';

import React from 'react';
import { Track } from 'livekit-client';
import { useTrackToggle } from '@livekit/components-react';
import { useVolumeMixer } from '@/lib/VolumeMixerContext';

export function KeyboardShortcuts() {
  const { toggle: toggleMic } = useTrackToggle({ source: Track.Source.Microphone });
  const { toggle: toggleCamera } = useTrackToggle({ source: Track.Source.Camera });
  // Modo foco perdeu o botao da barra de controles de proposito: e uma acao de
  // atalho (aperta no meio do jogo), nao um botao pra ficar ocupando espaco. A
  // configuracao — quem continuar ouvindo — fica na janela de configuracoes, e
  // o estado aparece no anel roxo dos tiles.
  const mixer = useVolumeMixer();
  const toggleFocus = mixer?.toggleFocus;

  React.useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      // Toggle microphone: Cmd/Ctrl-Shift-A
      if (toggleMic && event.key === 'A' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        toggleMic();
      }

      // Toggle camera: Cmd/Ctrl-Shift-V
      if (event.key === 'V' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        toggleCamera();
      }

      // Modo foco: Cmd/Ctrl-Shift-F. Mesma familia dos dois de cima (o `F`
      // sozinho ja e tela cheia, ver CallStage.tsx).
      if (toggleFocus && event.key === 'F' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        toggleFocus();
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [toggleMic, toggleCamera, toggleFocus]);

  return null;
}
