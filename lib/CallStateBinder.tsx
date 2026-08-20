'use client';

// Componente SEM UI. Mora dentro do `RoomContext` (montado no
// PageClientImpl, ao lado do <MicProcessorBinder />) e empurra o estado ao vivo
// dos participantes pro `CallStateContext`, que fica acima da sidebar.
//
// Ver o desenho completo em CallStateContext.tsx. O padrao — contexto acima das
// duas arvores + binder headless dentro do RoomContext — e o mesmo do
// MicProcessorBinder, e existe porque a sidebar e IRMA da call, nao
// descendente.

import * as React from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Participant } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { useCallState, type LiveParticipantState } from './CallStateContext';

function describe(p: Participant, speakingIdentities: Set<string>): LiveParticipantState {
  const mic = p.getTrackPublication(Track.Source.Microphone);
  const cam = p.getTrackPublication(Track.Source.Camera);
  return {
    name: p.name || p.identity,
    // Sem microfone publicado conta como mudo — mesma regra do servidor em
    // /api/channels/presence, pra sidebar nao piscar quando a fonte troca de
    // polling pra ao vivo.
    muted: !mic || mic.isMuted,
    camera: !!cam && !cam.isMuted,
    screenShare: !!p.getTrackPublication(Track.Source.ScreenShare),
    screenShareAudio: !!p.getTrackPublication(Track.Source.ScreenShareAudio),
    speaking: speakingIdentities.has(p.identity),
  };
}

// Sem props de proposito: o slug do canal e o proprio `room.name` (a sala do
// LiveKit e nomeada com o slug — ver /api/connection-details, que recusa
// roomName que nao corresponda a um canal cadastrado). Ler dali evita ter que
// furar o prop drilling ate o componente interno do PageClientImpl.
export function CallStateBinder() {
  const room = useRoomContext();
  const callState = useCallState();
  const publish = callState?.publish;

  React.useEffect(() => {
    if (!room || !publish) {
      return;
    }

    // Recalcula o mapa INTEIRO a cada evento, em vez de aplicar deltas. Com
    // 2-5 pessoas o custo e irrelevante, e evita a classe de bug em que um
    // evento perdido deixa o mapa dessincronizado pra sempre.
    const recompute = () => {
      // Antes de conectar, `room.name` e vazio — sem canal, nao ha o que a
      // sidebar possa aplicar. O evento Connected dispara outro recompute.
      if (!room.name) {
        publish(null, {}, null);
        return;
      }
      const speaking = new Set(room.activeSpeakers.map((p) => p.identity));
      const byIdentity: Record<string, LiveParticipantState> = {};
      byIdentity[room.localParticipant.identity] = describe(room.localParticipant, speaking);
      for (const remote of room.remoteParticipants.values()) {
        byIdentity[remote.identity] = describe(remote, speaking);
      }
      publish(room.name, byIdentity, room.localParticipant.identity);
    };

    const events: RoomEvent[] = [
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ActiveSpeakersChanged,
      // Reconexao pode ter perdido eventos enquanto estava fora.
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
  }, [room, publish]);

  // Ao desmontar (sair da call), limpa — senao a sidebar continuaria mostrando
  // estado ao vivo de um canal em que voce nao esta mais, sem nunca atualizar.
  React.useEffect(() => {
    return () => {
      publish?.(null, {}, null);
    };
  }, [publish]);

  return null;
}
