'use client';

// Estado ao vivo dos participantes da call em que VOCE esta, publicado num
// contexto que fica ACIMA da sidebar e da chamada.
//
// POR QUE ISTO EXISTE
// -------------------
// A `ChannelSidebar` mostra quem esta em cada canal com icones de mudo /
// camera / LIVE. Ela renderiza FORA do `RoomContext` (e irma do
// `PageClientImpl` dentro do `RoomShell`, e tambem roda na home e nos canais de
// texto, onde nao existe `Room` nenhum), entao nenhum hook do LiveKit funciona
// la — a fonte dela e o polling HTTP de /api/channels/presence, a cada 4s.
//
// 4s e aceitavel pra "quem esta aqui", mas ruim pra "esta mudo": voce se muta e
// o proprio icone so mudaria segundos depois. A solucao e a mesma que o projeto
// ja usa pro processamento de microfone (ver MicProcessorContext.tsx): um
// provider acima das duas arvores, alimentado por um componente headless
// montado dentro do `RoomContext`.
//
// Resultado: no canal em que voce esta, os icones reagem na hora; nos demais
// canais o polling continua sendo a fonte. A sidebar faz a mesclagem.

import * as React from 'react';

export interface LiveParticipantState {
  /** Username limpo (`participant.name`). A chave do mapa e a `identity`, que
   * carrega sufixo aleatorio por conexao e nao serve pra casar com avatar nem
   * com volume salvo — por isso o nome vem junto. */
  name: string;
  muted: boolean;
  camera: boolean;
  screenShare: boolean;
  /** Publicando audio junto com a tela (fonte separada da voz). */
  screenShareAudio: boolean;
  speaking: boolean;
}

export interface CallStateValue {
  /** Slug do canal a que este estado se refere. A sidebar so aplica o estado
   * ao vivo nesse canal — nos outros ela nao tem informacao nenhuma. */
  slug: string | null;
  /** Chaveado por `identity` (que traz sufixo aleatorio, ver
   * /api/connection-details), nao por username. */
  byIdentity: Record<string, LiveParticipantState>;
  /** A minha propria identity nesta call. Serve pra quem consome distinguir
   * "eu" dos outros — o mixer, por exemplo, nao mostra slider pra voce mesmo. */
  localIdentity: string | null;
  /** Chamado pelo `<CallStateBinder />`. Nao usar de fora dele. */
  publish: (
    slug: string | null,
    byIdentity: Record<string, LiveParticipantState>,
    localIdentity: string | null,
  ) => void;
}

const CallStateContext = React.createContext<CallStateValue | null>(null);

export function CallStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{
    slug: string | null;
    byIdentity: Record<string, LiveParticipantState>;
    localIdentity: string | null;
  }>({ slug: null, byIdentity: {}, localIdentity: null });

  const publish = React.useCallback(
    (
      slug: string | null,
      byIdentity: Record<string, LiveParticipantState>,
      localIdentity: string | null,
    ) => {
      setState({ slug, byIdentity, localIdentity });
    },
    [],
  );

  const value = React.useMemo<CallStateValue>(
    () => ({
      slug: state.slug,
      byIdentity: state.byIdentity,
      localIdentity: state.localIdentity,
      publish,
    }),
    [state, publish],
  );

  return <CallStateContext.Provider value={value}>{children}</CallStateContext.Provider>;
}

/** `null` fora do provider (home, admin, canal de texto sem call). Quem
 * consome deve tratar esse caso caindo no dado do polling. */
export function useCallState(): CallStateValue | null {
  return React.useContext(CallStateContext);
}
