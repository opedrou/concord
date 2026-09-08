import { describe, it, expect } from 'vitest';
import { DisconnectReason } from 'livekit-client';
import { isDefinitiveDisconnect } from './disconnectReason';

describe('isDefinitiveDisconnect', () => {
  it('sai do canal quando a saída foi de propósito', () => {
    for (const reason of [
      DisconnectReason.CLIENT_INITIATED,
      DisconnectReason.PARTICIPANT_REMOVED,
      DisconnectReason.ROOM_DELETED,
      DisconnectReason.ROOM_CLOSED,
    ]) {
      expect(isDefinitiveDisconnect(reason)).toBe(true);
    }
  });

  // A aba antiga é sempre quem recebe este motivo, já substituída por outra
  // com o mesmo tabSessionId — reconectar poria as duas em loop.
  it('trata identity duplicada como definitiva', () => {
    expect(isDefinitiveDisconnect(DisconnectReason.DUPLICATE_IDENTITY)).toBe(true);
  });

  // O caso que fazia a chamada morrer no celular: sem isto, uma queda de
  // sinalização mandava a pessoa pra home em vez de reconectar.
  it('tenta voltar quando a queda foi transitória', () => {
    for (const reason of [
      DisconnectReason.SIGNAL_CLOSE,
      DisconnectReason.SERVER_SHUTDOWN,
      DisconnectReason.STATE_MISMATCH,
      DisconnectReason.JOIN_FAILURE,
      undefined,
    ]) {
      expect(isDefinitiveDisconnect(reason)).toBe(false);
    }
  });
});
