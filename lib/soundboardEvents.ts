'use client';

// Disparo da soundboard: quem toca avisa, e cada cliente toca o arquivo
// localmente.
//
// POR QUE NÃO UMA TRACK DE ÁUDIO
// ------------------------------
// O requisito é "dá pra calar a soundboard do fulano e continuar ouvindo a voz
// dele". A conclusão natural é publicar o som numa track separada da voz — e
// funciona. Mas dá pra atender o mesmo requisito sem trafegar áudio nenhum:
// quem toca manda `{ soundId }` pelo canal de dados (já permitido pelo grant
// atual, `canPublishData`), e cada cliente busca o MP3 da biblioteca
// compartilhada e toca no próprio alto-falante. Mutar a soundboard de alguém
// vira ignorar os eventos daquela identidade — uma linha.
//
// O que se ganha: zero banda de upload pra quem toca, som imediato (publicar
// uma track exige renegociação, ~1s), nenhuma track extra pendurada por
// participante, e o volume por pessoa continua no mesmo lugar dos outros (o
// `VolumeMixerContext`) — o que a track NÃO permitiria, porque
// `RemoteParticipant.setVolume` só aceita `Microphone` e `ScreenShareAudio`.
//
// O que se perde: a gravação/egress do LiveKit não captura o som (ele nunca
// entra no SFU), e cada cliente toca no seu próprio tempo — diferença de
// alguns milissegundos, irrelevante pra um efeito de 1–2s e inaceitável pra
// música. Soundboard não é tocar música junto.

import * as React from 'react';
import { useDataChannel } from '@livekit/components-react';
import { playSfx, stopAllSfx } from './sfx';
import { useVolumeMixer } from './VolumeMixerContext';

export const SOUNDBOARD_TOPIC = 'soundboard';

/** Dois toques da MESMA pessoa dentro dessa janela: só o primeiro vale. */
const COOLDOWN_MS = 800;

interface SoundboardMessage {
  soundId: number;
  /** Só pra UI mostrar "fulano tocou X" sem ter que procurar na lista. */
  name: string;
  url: string;
  /** Corte gravado na biblioteca; o arquivo continua inteiro no servidor. */
  trimStart?: number;
  trimEnd?: number | null;
}

/**
 * "Parar tudo". Vai pelo mesmo tópico: quem pediu silêncio quer silêncio na
 * call, não só no próprio fone — o som está tocando no alto-falante de cada
 * um, então parar tem que ser um evento igual ao de tocar. Qualquer um pode
 * parar qualquer som (grupo de amigos; a alternativa seria só quem tocou poder
 * parar, o que deixa o resto refém de um áudio de 10s).
 */
interface SoundboardStopMessage {
  stop: true;
}

type IncomingMessage = Partial<SoundboardMessage & SoundboardStopMessage>;

/** O que o `play` precisa saber de um som da biblioteca. */
export interface SoundboardPlayable {
  id: number;
  name: string;
  url: string;
  trimStart?: number;
  trimEnd?: number | null;
}

export interface SoundboardEvent {
  /** Username limpo de quem tocou. */
  by: string;
  name: string;
  at: number;
}

/**
 * Liga o canal de dados ao tocador. Precisa estar dentro do `RoomContext`.
 *
 * @returns `play` pra disparar um som (toca pra você também, sem esperar eco
 *   do servidor) e o último evento recebido, pra UI.
 */
export function useSoundboard(): {
  play: (sound: SoundboardPlayable) => void;
  /** Corta o que estiver tocando, aqui e na máquina de todo mundo. */
  stop: () => void;
  lastEvent: SoundboardEvent | null;
} {
  const mixer = useVolumeMixer();
  const [lastEvent, setLastEvent] = React.useState<SoundboardEvent | null>(null);
  const lastPlayedByRef = React.useRef<Record<string, number>>({});

  // Refs pra o handler não precisar do mixer nas deps — ele muda a cada ajuste
  // de slider, e o `useDataChannel` reassinaria o canal junto.
  const mixerRef = React.useRef(mixer);
  mixerRef.current = mixer;

  const handleMessage = React.useCallback(
    (msg: { payload: Uint8Array; from?: { identity: string; name?: string } }) => {
      let parsed: IncomingMessage;
      try {
        parsed = JSON.parse(new TextDecoder().decode(msg.payload)) as IncomingMessage;
      } catch {
        return;
      }

      const by = msg.from?.name || msg.from?.identity || 'alguém';

      // Antes do cooldown de propósito: parar nunca pode ser engolido pelo
      // anti-spam — é justamente o que a pessoa aperta quando o som está
      // demais.
      if (parsed.stop) {
        stopAllSfx();
        setLastEvent(null);
        return;
      }

      if (typeof parsed.url !== 'string') {
        return;
      }

      // Anti-spam: uma pessoa não consegue transformar isso em metralhadora.
      const now = Date.now();
      if (now - (lastPlayedByRef.current[by] ?? 0) < COOLDOWN_MS) {
        return;
      }
      lastPlayedByRef.current[by] = now;

      const current = mixerRef.current;
      // Volume da soundboard DAQUELA pessoa (0 = calada), multiplicado pelo
      // volume geral. Mesmo mixer da voz e do áudio de tela.
      const individual = current?.volumeFor(by, 'soundboard') ?? 1;
      const master = current?.master ?? 1;
      const focusMuted = current?.isFocusMuted(by) ?? false;
      const gain = focusMuted ? 0 : Math.min(individual * master, 2);

      setLastEvent({ by, name: parsed.name ?? 'um som', at: now });
      if (gain > 0) {
        playSfx(parsed.url, {
          gain,
          start: parsed.trimStart ?? 0,
          end: parsed.trimEnd ?? undefined,
        });
      }
    },
    [],
  );

  const { send } = useDataChannel(SOUNDBOARD_TOPIC, handleMessage);

  const play = React.useCallback(
    (sound: SoundboardPlayable) => {
      const payload: SoundboardMessage = {
        soundId: sound.id,
        name: sound.name,
        url: sound.url,
        trimStart: sound.trimStart,
        trimEnd: sound.trimEnd,
      };
      // `reliable`: um som que não chega é pior que um som atrasado, e o
      // volume de tráfego aqui é ridículo (algumas dezenas de bytes).
      void send(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true }).catch(() => {
        // Sem conexão de dados — quem tocou ainda ouve o próprio som.
      });

      // Toca localmente na hora, sem esperar eco: o próprio `send` não volta
      // pra quem enviou, e esperar confirmação só adicionaria latência.
      const current = mixerRef.current;
      playSfx(sound.url, {
        gain: current?.master ?? 1,
        start: sound.trimStart,
        end: sound.trimEnd ?? undefined,
      });
      setLastEvent({ by: 'você', name: sound.name, at: Date.now() });
    },
    [send],
  );

  const stop = React.useCallback(() => {
    // Para na hora pra quem apertou, mesmo que o canal de dados esteja fora.
    stopAllSfx();
    setLastEvent(null);
    const payload: SoundboardStopMessage = { stop: true };
    void send(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true }).catch(() => {
      // Sem conexão de dados — os outros continuam ouvindo até o som acabar.
    });
  }, [send]);

  return { play, stop, lastEvent };
}
