'use client';

// Estado do botao de FONE (surdo) e do botao de MICROFONE do rodape da
// sidebar.
//
// POR QUE UMA STORE DE MODULO, E NAO MAIS UM CONTEXT
// -------------------------------------------------
// Mesmo motivo do lib/soundPrefs.ts (leia o cabecalho dele): isto precisa
// existir FORA de uma call. O rodape da sidebar aparece na home e nos canais
// de texto, onde nao ha `Room` nenhum, e o requisito e justamente "clicou
// fora da call, entra na proxima ja silenciado". Um Context exigiria um
// provider acima de tudo e ainda assim morreria a cada navegacao; uma store de
// modulo com `useSyncExternalStore` + `localStorage` atravessa as duas coisas
// de graca.
//
// Quem LE isto:
//   - o rodape da ChannelSidebar (os dois botoes);
//   - o <DeafenBinder />, que aplica o mute ao `Room` (e o unico que enxerga
//     a call);
//   - o <VolumeMixerBinder />, que zera o ganho de todo mundo quando surdo;
//   - o `playSfx` (lib/sfx.ts), que engole os sons de presenca e a soundboard.
//
// REGRAS DE COMPORTAMENTO (as do Discord)
// ---------------------------------------
//   - Ficar surdo MUTA voce junto.
//   - Sair do surdo devolve o microfone ao estado ANTERIOR — quem ja estava
//     mudo continua mudo. Por isso guardamos `micMutedBeforeDeafen`.
//   - Desmutar o microfone (por onde for: rodape ou ControlBar da call)
//     DESLIGA o surdo. Sem isso existiria um estado sem sentido — voz saindo,
//     nada entrando — e o botao de microfone viraria um no-op enquanto surdo.

import * as React from 'react';

const DEAFENED_KEY = 'concord-deafened';
const MIC_MUTED_KEY = 'concord-mic-muted';
const MIC_BEFORE_KEY = 'concord-mic-muted-before-deafen';

export interface DeafenPrefs {
  /** Nada entra: vozes, audio de tela, soundboard e sons de presenca. */
  deafened: boolean;
  /** Meu microfone esta mudo. */
  micMuted: boolean;
}

// Valor inicial IGUAL no servidor e no cliente; a leitura do localStorage
// acontece em `hydrate()`, chamada de dentro de um efeito. Ler aqui daria
// divergencia de hidratacao (os botoes piscariam com o icone trocado).
let prefs: DeafenPrefs = { deafened: false, micMuted: false };
let micMutedBeforeDeafen = false;
let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function hydrate() {
  if (hydrated || typeof window === 'undefined') {
    return;
  }
  hydrated = true;
  try {
    prefs = {
      deafened: window.localStorage.getItem(DEAFENED_KEY) === '1',
      micMuted: window.localStorage.getItem(MIC_MUTED_KEY) === '1',
    };
    micMutedBeforeDeafen = window.localStorage.getItem(MIC_BEFORE_KEY) === '1';
  } catch {
    // localStorage indisponivel (modo privado, quota). Segue com os defaults.
  }
  emit();
}

function persist() {
  try {
    window.localStorage.setItem(DEAFENED_KEY, prefs.deafened ? '1' : '0');
    window.localStorage.setItem(MIC_MUTED_KEY, prefs.micMuted ? '1' : '0');
    window.localStorage.setItem(MIC_BEFORE_KEY, micMutedBeforeDeafen ? '1' : '0');
  } catch {
    // Persistencia e bonus; a escolha ainda vale pra sessao atual.
  }
}

function commit(next: DeafenPrefs) {
  if (next.deafened === prefs.deafened && next.micMuted === prefs.micMuted) {
    // Nada mudou. Sair aqui e o que impede o ping-pong entre o binder (que
    // espelha a sala pra ca) e o efeito que aplica isto de volta na sala.
    return;
  }
  prefs = next;
  persist();
  emit();
}

export function setDeafened(deafened: boolean) {
  if (deafened === prefs.deafened) {
    return;
  }
  if (deafened) {
    micMutedBeforeDeafen = prefs.micMuted;
    commit({ deafened: true, micMuted: true });
  } else {
    commit({ deafened: false, micMuted: micMutedBeforeDeafen });
  }
}

/**
 * Unica porta de entrada do mute do microfone — usada tanto pelo botao do
 * rodape quanto pelo `<DeafenBinder />` quando o mute veio da ControlBar da
 * call. Desmutar desliga o surdo (ver as regras no topo).
 */
export function setMicMuted(micMuted: boolean) {
  commit({ deafened: micMuted ? prefs.deafened : false, micMuted });
}

/** Leitura direta, pra quem nao e componente (o `playSfx`). */
export function getDeafenPrefs(): DeafenPrefs {
  return prefs;
}

export function useDeafenPrefs(): DeafenPrefs {
  React.useEffect(hydrate, []);
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => prefs,
    // Snapshot do servidor: o mesmo objeto default, sem tocar em localStorage.
    () => prefs,
  );
}
