'use client';

// Componente SEM UI. Mora dentro do `RoomContext` (montado no PageClientImpl,
// ao lado do <MicProcessorBinder />, do <CallStateBinder /> e do
// <VolumeMixerBinder />) e liga o mute do rodape da sidebar ao `Room`.
//
// E o mesmo desenho de duas camadas dos vizinhos, com uma diferenca: aqui NAO
// existe um Context novo. O estado mora numa store de modulo
// (lib/deafenPrefs.ts) porque precisa sobreviver FORA de uma call — ver o
// cabecalho de la. Este binder e so a metade "aplica no Room".
//
// Ele e de mao dupla, e a ordem importa:
//   Sidebar -> Room : voce clicou no botao do rodape; publica/muta a track.
//   Room -> Sidebar : voce clicou na ControlBar da call (ou o SDK mexeu);
//                     a store adota o estado da sala, pros dois botoes
//                     nunca discordarem.
//
// O QUE ELE NAO FAZ: ligar o microfone sozinho. Enquanto os dois lados ainda
// nao concordaram (os primeiros instantes depois de conectar), quem manda e a
// store SO na direcao "mudo" — nunca na direcao "abre o microfone". Entrar num
// canal com o microfone fechado e uma escolha valida (`audioEnabled` do
// lk-user-choices, ver lib/userChoices.ts), e um binder que forcasse
// `setMicrophoneEnabled(true)` abriria o microfone de quem nao pediu.
//
// O surdo em si (zerar o que ENTRA) nao esta aqui: as vozes e o audio de tela
// sao zerados no <VolumeMixerBinder />, que ja e o unico dono do `setVolume`,
// e os sons de presenca / soundboard no `playSfx` (lib/sfx.ts).

import * as React from 'react';
import { RoomEvent, Track } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';
import { setMicMuted, useDeafenPrefs } from './deafenPrefs';

export function DeafenBinder() {
  const room = useRoomContext();
  const { micMuted } = useDeafenPrefs();

  const readMicPublication = React.useCallback(
    () => room?.localParticipant.getTrackPublication(Track.Source.Microphone),
    [room],
  );

  // Sem track publicada ainda conta como mudo — mesma regra do
  // CallStateBinder, pra sidebar nao piscar.
  const readRoomMuted = React.useCallback(() => {
    const publication = readMicPublication();
    return !publication || publication.isMuted;
  }, [readMicPublication]);

  const applyToRoom = React.useCallback(
    (muted: boolean) => {
      room?.localParticipant.setMicrophoneEnabled(!muted).catch((error) => {
        // Permissao negada / dispositivo sumiu. A ControlBar da call ja mostra
        // o erro de dispositivo; aqui so nao pode escapar rejeicao solta.
        console.error('Erro ao aplicar o mute do microfone:', error);
      });
    },
    [room],
  );

  // `true` a partir do momento em que a store e a sala concordaram uma vez.
  // Antes disso a sala ainda esta se montando (conectar, publicar a track) e
  // adotar o que ela diz atropelaria a escolha persistida.
  const agreedRef = React.useRef(false);
  React.useEffect(() => {
    agreedRef.current = false;
  }, [room]);

  const micMutedRef = React.useRef(micMuted);
  micMutedRef.current = micMuted;

  // Room -> store.
  React.useEffect(() => {
    if (!room) {
      return;
    }
    const onRoomChange = () => {
      const roomMuted = readRoomMuted();
      if (roomMuted === micMutedRef.current) {
        agreedRef.current = true;
        return;
      }
      if (!agreedRef.current) {
        // Ainda entrando na call. A store manda, mas so pra MUTAR.
        if (micMutedRef.current) {
          applyToRoom(true);
        } else if (readMicPublication()) {
          // A track existe e esta muda enquanto a store diz que nao: a
          // decisao veio da ControlBar antes de os dois lados terem
          // concordado. Adota — abrir o microfone de alguem, nunca.
          // Sem publicacao nenhuma nao ha o que adotar: e so o `connect()`
          // que ainda nao publicou (ver PageClientImpl), e mutar aqui
          // fecharia o microfone de quem nao pediu.
          setMicMuted(true);
          agreedRef.current = true;
        }
        return;
      }
      // Ja estavamos em sincronia: a mudanca veio da ControlBar da call.
      setMicMuted(roomMuted);
    };

    const events: RoomEvent[] = [
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.Connected,
      RoomEvent.Reconnected,
    ];
    for (const event of events) {
      room.on(event, onRoomChange);
    }
    onRoomChange();

    return () => {
      for (const event of events) {
        room.off(event, onRoomChange);
      }
    };
  }, [room, readRoomMuted, readMicPublication, applyToRoom]);

  // Store -> Room. Roda quando `micMuted` muda: clique no rodape, ou o surdo
  // mutando junto. Se a sala ja concorda (foi ela quem mudou, logo acima), o
  // early return corta o ciclo.
  React.useEffect(() => {
    if (!room || readRoomMuted() === micMuted) {
      return;
    }
    // Aqui a mudanca e sempre acao consciente da pessoa, entao vale nos dois
    // sentidos — inclusive publicar a track pra desmutar.
    applyToRoom(micMuted);
    agreedRef.current = true;
  }, [room, micMuted, readRoomMuted, applyToRoom]);

  return null;
}
