'use client';

// Quantas pessoas estao assistindo cada transmissao de tela.
//
// O ROADMAP DIZIA QUE ESSE DADO JA EXISTIA NO LIVEKIT. NAO EXISTE.
// ----------------------------------------------------------------
// Nem o cliente nem o servidor expoem "quem assina esta track":
// `LocalTrackPublication` nao tem lista nem contagem de assinantes, nao ha
// evento de "fulano assinou a sua track", e o `TrackInfo` do protocolo (que e
// o que `RoomServiceClient.listParticipants` devolve) tambem nao carrega isso.
// O `RoomEvent.LocalTrackSubscribed` tem nome parecido mas e outra coisa: e a
// confirmacao de que o SERVIDOR aceitou a track que VOCE publicou.
//
// Entao o dado e derivado: cada pessoa ANUNCIA o que esta assistindo, e todo
// mundo conta. Isso so e barato porque o estado ja existe pronto — e o mesmo
// que decide o "parar de assistir" (ver CallStage.tsx).
//
// POR QUE ATRIBUTO DE PARTICIPANTE E NAO publishData
// --------------------------------------------------
// Atributo e ESTADO; mensagem de dados e EVENTO. Com atributo, quem entra na
// sala depois ja recebe o valor atual de todo mundo no proprio snapshot do
// participante. Com publishData seria preciso reanunciar periodicamente (ou
// inventar um protocolo de "cheguei, me contem o estado"), e quem entrasse no
// meio veria contador errado ate o proximo anuncio.
//
// Exige o grant `canUpdateOwnMetadata` no token — ver
// app/api/connection-details/route.ts. Sem ele o `setAttributes` e recusado em
// silencio e o contador fica zerado.

import * as React from 'react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { useRoomContext } from '@livekit/components-react';

/** Chave do atributo. Prefixada porque o mapa de atributos e global da sala. */
const WATCHING_ATTRIBUTE = 'concord.watching';

// Atributo trafega pelo canal de sinalizacao. Sem debounce, alternar
// assistir/parar algumas vezes seguidas viraria uma rajada de escritas.
const PUBLISH_DEBOUNCE_MS = 500;

function parseWatching(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split(',').filter(Boolean);
}

/**
 * @param watchedSids sids das transmissoes REMOTAS que este cliente esta
 *   assistindo agora. A ordem nao importa; o hook normaliza.
 * @returns mapa `trackSid -> numero de pessoas assistindo` (inclui voce).
 */
export function useScreenShareViewers(watchedSids: readonly string[]): Record<string, number> {
  const room = useRoomContext();
  const [viewers, setViewers] = React.useState<Record<string, number>>({});

  // Chave estavel: `watchedSids` costuma ser um array novo a cada render (vem
  // de um filter), e usar o array direto na dep do efeito republicaria o
  // atributo a cada render.
  const watchingKey = React.useMemo(() => [...watchedSids].sort().join(','), [watchedSids]);

  // --- Lado de escrita: anuncia o que EU estou assistindo -------------------
  React.useEffect(() => {
    if (!room) {
      return;
    }

    const publish = () => {
      // Antes de conectar, `setAttributes` nao tem pra onde ir. Isso acontece
      // de verdade: o CallStage monta enquanto a sala ainda esta conectando, e
      // sem este guard o primeiro anuncio (o unico, se voce nunca mexer no
      // "parar de assistir") se perderia em silencio.
      if (room.state !== ConnectionState.Connected) {
        return;
      }
      // `setAttributes` faz MERGE com os atributos existentes (confirmado na
      // doc da lib), entao mandar so a nossa chave nao apaga nada de ninguem.
      room.localParticipant.setAttributes({ [WATCHING_ATTRIBUTE]: watchingKey }).catch(() => {
        // Falta do grant `canUpdateOwnMetadata` cai aqui. Nao adianta insistir
        // nem avisar em toast: o efeito visivel e o contador nao aparecer, que
        // e o comportamento correto — melhor nenhum numero que um errado.
      });
    };

    const timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS);
    // Reanuncia ao (re)conectar: os atributos nao sobrevivem a uma reconexao.
    room.on(RoomEvent.Connected, publish);
    room.on(RoomEvent.Reconnected, publish);
    return () => {
      clearTimeout(timer);
      room.off(RoomEvent.Connected, publish);
      room.off(RoomEvent.Reconnected, publish);
    };
  }, [room, watchingKey]);

  // --- Lado de leitura: conta o anuncio de todo mundo -----------------------
  React.useEffect(() => {
    if (!room) {
      return;
    }

    // Recalcula o mapa inteiro a cada evento em vez de aplicar deltas — mesma
    // escolha (e mesmo motivo) do CallStateBinder: com 2-5 pessoas o custo e
    // irrelevante e um evento perdido nao deixa o estado torto pra sempre.
    const recompute = () => {
      const counts: Record<string, number> = {};
      const tally = (attributes: Record<string, string> | undefined) => {
        for (const sid of parseWatching(attributes?.[WATCHING_ATTRIBUTE])) {
          counts[sid] = (counts[sid] ?? 0) + 1;
        }
      };
      // O local tambem conta: se so eu estou vendo, o numero e 1, nao 0. Uso o
      // valor ao vivo em vez do atributo publicado porque o debounce faz o
      // atributo chegar meio segundo atrasado — o proprio contador nao pode
      // piscar por causa disso.
      for (const sid of parseWatching(watchingKey)) {
        counts[sid] = (counts[sid] ?? 0) + 1;
      }
      for (const remote of room.remoteParticipants.values()) {
        tally(remote.attributes);
      }
      setViewers(counts);
    };

    const events: RoomEvent[] = [
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      // Ao (re)conectar chegam os atributos de quem ja estava na sala.
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
  }, [room, watchingKey]);

  return viewers;
}
