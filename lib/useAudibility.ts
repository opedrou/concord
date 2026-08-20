'use client';

// Lado de LEITURA: para cada pessoa na sala, ela está me ouvindo?
//
// Duas fontes, ambas anunciadas por atributo de participante (ver
// lib/audibility.ts): o modo foco e a lista de mute individual. Quem publica é
// o <VolumeMixerBinder />.
//
// Mesma forma do lib/useScreenShareViewers.ts — recalcula o mapa inteiro a cada
// evento em vez de aplicar deltas, porque com 2-5 pessoas o custo é irrelevante
// e um evento perdido não deixa o estado torto pra sempre.

import * as React from 'react';
import { RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import {
  FOCUS_ATTRIBUTE,
  MUTED_ATTRIBUTE,
  parseFocus,
  parseMuted,
  ringFor,
  type Audibility,
} from './audibility';

/** `identity` -> o que o tile daquela pessoa precisa mostrar, pra MIM. */
export function useAudibility(): Record<string, Audibility> {
  const room = useRoomContext();
  const [state, setState] = React.useState<Record<string, Audibility>>({});

  React.useEffect(() => {
    if (!room) {
      return;
    }

    const recompute = () => {
      const myName = room.localParticipant.name || room.localParticipant.identity;
      const next: Record<string, Audibility> = {};
      for (const remote of room.remoteParticipants.values()) {
        const attrs = remote.attributes;
        const ring = ringFor(parseFocus(attrs?.[FOCUS_ATTRIBUTE]), myName);
        const mutedMe = parseMuted(attrs?.[MUTED_ATTRIBUTE]).has(myName);
        if (ring || mutedMe) {
          next[remote.identity] = { ring, mutedMe };
        }
      }
      setState(next);
    };

    const events: RoomEvent[] = [
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const event of events) {
      room.on(event, recompute);
    }
    recompute();

    return () => {
      for (const event of events) {
        room.off(event, recompute);
      }
    };
  }, [room]);

  return state;
}
