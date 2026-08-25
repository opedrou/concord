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
import { ConnectionState, RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { useVolumeMixer } from './VolumeMixerContext';
import { LIVEKIT_SOURCE, effectiveGain } from './participantVolumes';
import { FOCUS_ATTRIBUTE, MUTED_ATTRIBUTE, encodeFocus, encodeMuted } from './audibility';
import { useDeafenPrefs } from './deafenPrefs';

/** As fontes que são track do LiveKit. A soundboard é tocada localmente. */
const APPLIED_SOURCES = ['mic', 'screenShareAudio'] as const;

/**
 * BUG DO `livekit-client` (2.20.1) QUE ISTO CONTORNA — "o mute solta sozinho".
 *
 * O `RemoteAudioTrack` guarda o último volume em `this.elementVolume` e, toda
 * vez que precisa reconstruir o caminho de áudio, reaplica esse valor assim:
 *
 *     if (this.elementVolume) { this.setVolume(this.elementVolume); }
 *
 * `0` é falsy em JS. Ou seja: quem estava com volume 0 (mute individual, ou
 * calado pelo modo foco) NÃO tem o volume reaplicado — o `GainNode` novo nasce
 * no default 1.0 e a pessoa volta a ser ouvida no volume cheio. Está em três
 * lugares do dist: `attach()`, `connectWebAudio()` e `getVolume()`.
 *
 * E esse caminho é refeito o tempo todo sem nada de errado acontecer:
 * `Room.acquireAudioContext()` roda em todo reconnect e em todo
 * `room.startAudio()` (o botão "Ativar áudio" da ControlBar, e no iOS o
 * próprio SDK rechama sozinho no `visibilitychange`), e o `attach()` roda
 * sempre que o elemento de áudio é remontado. Daí o "depois de algum tempo".
 *
 * A saída é não guardar 0 no LiveKit: −140 dB é inaudível (muito abaixo do
 * piso de ruído de 16 bits) e, principalmente, é TRUTHY — então o SDK reaplica
 * em todos os caminhos, inclusive nos que não emitem evento nenhum pra gente
 * escutar. Corrigir por evento sozinho não resolveria: `attach()` não avisa.
 */
const SILENT_GAIN = 1e-7;

export function VolumeMixerBinder() {
  const room = useRoomContext();
  const mixer = useVolumeMixer();

  // Refs pra o efeito de eventos não precisar do mixer inteiro nas deps (o
  // valor do contexto muda a cada ajuste de slider, e reassinar todos os
  // eventos do Room a cada pixel de arrasto seria desperdício).
  const mixerRef = React.useRef(mixer);
  mixerRef.current = mixer;

  // Surdo (botão de fone do rodapé da sidebar, lib/deafenPrefs.ts): zera o que
  // ENTRA. Entra aqui, e não num lugar novo, porque este binder já é o único
  // dono do `setVolume` — e já cobre as duas fontes remotas que existem, a voz
  // e o áudio de compartilhamento de tela. Os sons de presença e a soundboard
  // não passam por `setVolume` (têm AudioContext próprio) e são silenciados no
  // `playSfx`.
  const { deafened } = useDeafenPrefs();
  const deafenedRef = React.useRef(deafened);
  deafenedRef.current = deafened;

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
        // O surdo, ao contrário do modo foco, cala TUDO — inclusive o áudio
        // da transmissão. É o ponto do botão: nada entra.
        const gain = deafenedRef.current
          ? 0
          : effectiveGain({
              individual: current.volumeFor(name, source),
              master: current.master,
              // O modo foco cala só a VOZ. Em jogo competitivo o áudio da
              // transmissão costuma ser exatamente o que se quer continuar
              // ouvindo — calar tudo transformaria o foco em "modo surdo".
              focusMuted: source === 'mic' && current.isFocusMuted(name),
            });
        participant.setVolume(gain > 0 ? gain : SILENT_GAIN, LIVEKIT_SOURCE[source]);
      }
    }
  }, [room]);

  // Reaplica quando o estado do mixer muda (slider, master, foco).
  React.useEffect(() => {
    applyAll();
  }, [applyAll, deafened, mixer?.master, mixer?.focus, mixer?.volumeFor]);

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
      // Emitido no fim do `acquireAudioContext()` — é o único aviso que chega
      // quando o `startAudio()` recria o AudioContext e, com ele, os GainNodes
      // de todo mundo. Sem isto, um clique em "Ativar áudio" devolvia todos os
      // volumes ajustados ao default. (O mute em si já está coberto pelo
      // SILENT_GAIN acima; isto cobre os volumes intermediários.)
      RoomEvent.AudioPlaybackStatusChanged,
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

  // Anuncia o modo foco pra sala: é assim que as outras pessoas descobrem que
  // você está em foco e se continuam sendo ouvidas (ver lib/focusBroadcast.ts).
  // Sem debounce curto isso viraria uma escrita de sinalização por clique de
  // checkbox.
  const focusPayload = mixer ? encodeFocus(mixer.focus.enabled, mixer.focus.allowed) : '';
  const mutedPayload = mixer ? encodeMuted(mixer.mutedNames) : '';
  React.useEffect(() => {
    if (!room) {
      return;
    }
    const publish = () => {
      if (room.state !== ConnectionState.Connected) {
        return;
      }
      // `setAttributes` faz merge — não atropela o `concord.watching` que o
      // contador de espectadores escreve.
      room.localParticipant
        .setAttributes({ [FOCUS_ATTRIBUTE]: focusPayload, [MUTED_ATTRIBUTE]: mutedPayload })
        .catch(() => {
          // Sem o grant `canUpdateOwnMetadata` cai aqui. O foco continua
          // funcionando pra quem ligou (o mute é local); só ninguém fica sabendo.
        });
    };
    const timer = setTimeout(publish, 300);
    room.on(RoomEvent.Connected, publish);
    room.on(RoomEvent.Reconnected, publish);
    return () => {
      clearTimeout(timer);
      room.off(RoomEvent.Connected, publish);
      room.off(RoomEvent.Reconnected, publish);
    };
  }, [room, focusPayload, mutedPayload]);

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
