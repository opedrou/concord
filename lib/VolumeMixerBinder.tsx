'use client';

// Componente SEM UI. Mora dentro do `RoomContext` (montado no PageClientImpl,
// ao lado do <MicProcessorBinder /> e do <CallStateBinder />) e é o ÚNICO
// lugar do app que chama `participant.setVolume`.
//
// Ver o desenho completo em VolumeMixerContext.tsx.
//
// BUG QUE ISTO CONSERTA: antes, o `setVolume` do volume salvo era chamado no
// mount do slider — ou seja, só acontecia enquanto o card de volume daquela
// pessoa estivesse ABERTO. Na prática o volume "persistido" nunca era aplicado
// ao entrar numa chamada; você tinha que clicar no tile de cada um pra que
// valesse. Aqui a aplicação é contínua e não depende de nenhuma UI estar viva.

import * as React from 'react';
import { RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { useVolumeMixer } from './VolumeMixerContext';
import { LIVEKIT_SOURCE, effectiveGain } from './participantVolumes';

/** As fontes que são track do LiveKit. A soundboard é tocada localmente. */
const APPLIED_SOURCES = ['mic', 'screenShareAudio'] as const;

export function VolumeMixerBinder() {
  const room = useRoomContext();
  const mixer = useVolumeMixer();

  // Refs pra o efeito de eventos não precisar do mixer inteiro nas deps (o
  // valor do contexto muda a cada ajuste de slider, e reassinar todos os
  // eventos do Room a cada pixel de arrasto seria desperdício).
  const mixerRef = React.useRef(mixer);
  mixerRef.current = mixer;

  const applyAll = React.useCallback(() => {
    const current = mixerRef.current;
    if (!room || !current) {
      return;
    }
    for (const participant of room.remoteParticipants.values()) {
      // `name` é o username limpo; `identity` traz sufixo aleatório por
      // conexão e não serve como chave (ver participantVolumes.ts).
      const name = participant.name || participant.identity;
      current.ensureLoaded(name);
      for (const source of APPLIED_SOURCES) {
        const gain = effectiveGain({
          individual: current.volumeFor(name, source),
          master: current.master,
          // O modo foco cala só a VOZ. Em jogo competitivo o áudio da
          // transmissão costuma ser exatamente o que se quer continuar
          // ouvindo — calar tudo transformaria o foco em "modo surdo".
          focusMuted: source === 'mic' && current.isFocusMuted(name),
        });
        participant.setVolume(gain, LIVEKIT_SOURCE[source]);
      }
    }
  }, [room]);

  // Reaplica quando o estado do mixer muda (slider, master, foco).
  React.useEffect(() => {
    applyAll();
  }, [applyAll, mixer?.master, mixer?.focus, mixer?.volumeFor]);

  // Reaplica quando a sala muda de forma (gente nova, track nova).
  React.useEffect(() => {
    if (!room) {
      return;
    }
    const events: RoomEvent[] = [
      RoomEvent.ParticipantConnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackPublished,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const event of events) {
      room.on(event, applyAll);
    }
    return () => {
      for (const event of events) {
        room.off(event, applyAll);
      }
    };
  }, [room, applyAll]);

  // Dispositivo de saída. `switchActiveDevice` já trata o caso `webAudioMix`
  // (chama `audioContext.setSinkId` quando o elemento de áudio não suporta),
  // então não há nada de Web Audio pra escrever aqui.
  const outputDeviceId = mixer?.outputDeviceId;
  React.useEffect(() => {
    if (!room || !outputDeviceId) {
      return;
    }
    room.switchActiveDevice('audiooutput', outputDeviceId).catch(() => {
      // Firefox não tem setSinkId. Quem avisa é a UI, que checa suporte antes
      // de oferecer o seletor — aqui só não podemos deixar a rejeição escapar.
    });
  }, [room, outputDeviceId]);

  return null;
}
