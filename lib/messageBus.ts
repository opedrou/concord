// Pub/sub em memória pra distribuir mensagens novas/apagadas de canais de
// texto aos clientes conectados via SSE (ver app/api/channels/[id]/messages/
// stream/route.ts).
//
// Não usamos Redis nem nada externo: a app roda como um único processo Node
// por container (mesmo modelo do lib/db.ts — singleton em `globalThis`), sem
// múltiplas réplicas atrás de um load balancer. Se isso mudar no futuro
// (escalar horizontalmente), esse bus precisa virar algo compartilhado entre
// processos — anotado como limitação conhecida.
import { EventEmitter } from 'node:events';

export interface MessageCreatedEvent {
  type: 'created';
  message: {
    id: number;
    channelId: number;
    authorId: number | null;
    authorName: string;
    content: string;
    createdAt: number;
  };
}

export interface MessageDeletedEvent {
  type: 'deleted';
  messageId: number;
  channelId: number;
}

export type ChannelMessageEvent = MessageCreatedEvent | MessageDeletedEvent;

declare global {
  // eslint-disable-next-line no-var
  var __messageBus: EventEmitter | undefined;
}

function getBus(): EventEmitter {
  if (!globalThis.__messageBus) {
    const bus = new EventEmitter();
    // Cada aba com um canal de texto aberto segura um listener; o default de
    // 10 do Node estouraria rápido com poucas pessoas em múltiplas abas.
    bus.setMaxListeners(0);
    globalThis.__messageBus = bus;
  }
  return globalThis.__messageBus;
}

function eventName(channelId: number): string {
  return `channel:${channelId}`;
}

/** Publica um evento pros assinantes atuais do canal (sem persistir nada aqui). */
export function publishChannelEvent(channelId: number, event: ChannelMessageEvent): void {
  getBus().emit(eventName(channelId), event);
}

/** Assina eventos de um canal. Retorna a função de cancelamento (chamar no cleanup). */
export function subscribeToChannel(
  channelId: number,
  listener: (event: ChannelMessageEvent) => void,
): () => void {
  const bus = getBus();
  const name = eventName(channelId);
  bus.on(name, listener);
  return () => bus.off(name, listener);
}
