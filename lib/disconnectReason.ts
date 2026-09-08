import { DisconnectReason } from 'livekit-client';

/**
 * A saida da sala foi DEFINITIVA (nao adianta tentar voltar)?
 *
 * Existe separada do componente porque e a decisao que fazia a chamada morrer
 * no celular: qualquer desconexao levava de volta pra home, entao o Chrome do
 * Android congelar a aba com a tela bloqueada equivalia a sair do canal. Ver
 * `handleOnLeave` em app/rooms/[roomName]/PageClientImpl.tsx.
 *
 * `DUPLICATE_IDENTITY` conta como definitiva de proposito: o `tabSessionId` e
 * o mesmo em toda reconexao desta aba, entao quem recebe esse motivo e sempre
 * a sessao ANTIGA, que outra ja substituiu. Reconectar poria duas abas se
 * derrubando em loop.
 *
 * Motivo ausente (`undefined`) conta como transitorio: e o que chega quando a
 * sinalizacao morre sem handshake de saida — exatamente o caso da queda de
 * rede que queremos recuperar.
 */
export function isDefinitiveDisconnect(reason?: DisconnectReason): boolean {
  return (
    reason === DisconnectReason.CLIENT_INITIATED ||
    reason === DisconnectReason.DUPLICATE_IDENTITY ||
    reason === DisconnectReason.PARTICIPANT_REMOVED ||
    reason === DisconnectReason.ROOM_DELETED ||
    reason === DisconnectReason.ROOM_CLOSED
  );
}
