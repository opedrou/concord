'use client';

// Preferências dos sons de presença (entrar, sair, transmissão abrindo e
// fechando): ligado/desligado e volume.
//
// POR QUE UMA STORE EM VEZ DE ESTADO NO COMPONENTE
// -----------------------------------------------
// Os mesmos dois valores são mexidos em DOIS lugares que não se enxergam: o
// botão de sino na `CallControlBar` (dentro do RoomContext) e a seção
// "Notificações" da janela de configurações (dentro da ChannelSidebar, ramo
// irmão). Sem um lugar comum, mudar num não atualizaria o outro até recarregar
// a página.
//
// Não virou Context porque não precisa: isto é preferência de máquina, não
// estado de chamada — não depende de nada da árvore e não muda por participante.
// Uma store de módulo com `useSyncExternalStore` custa menos que mais um
// provider aninhado no RoomShell (que já tem quatro).

import * as React from 'react';

const MUTED_KEY = 'concord-join-leave-sound-muted';
const VOLUME_KEY = 'concord-join-leave-sound-volume';

/** MP3 masterizado é bem mais alto que os bipes sintetizados de antes (pico de
 * ganho 0.12). Sem atenuar, o som de entrada competiria com a voz de quem está
 * falando. */
export const DEFAULT_SOUND_VOLUME = 0.6;

export interface SoundPrefs {
  muted: boolean;
  /** Ganho linear 0..1. */
  volume: number;
}

// Valor inicial IGUAL no servidor e no cliente. A leitura real do localStorage
// acontece em `hydrate()`, chamada de dentro de um efeito — ler aqui daria
// divergência de hidratação (o botão de sino piscaria com o ícone trocado).
let prefs: SoundPrefs = { muted: false, volume: DEFAULT_SOUND_VOLUME };
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
    const muted = window.localStorage.getItem(MUTED_KEY) === '1';
    const rawVolume = window.localStorage.getItem(VOLUME_KEY);
    const volume = rawVolume === null ? DEFAULT_SOUND_VOLUME : Number(rawVolume);
    prefs = {
      muted,
      volume: Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : DEFAULT_SOUND_VOLUME,
    };
  } catch {
    // localStorage indisponível (modo privado, quota). Segue com os defaults.
  }
  emit();
}

function persist() {
  try {
    window.localStorage.setItem(MUTED_KEY, prefs.muted ? '1' : '0');
    window.localStorage.setItem(VOLUME_KEY, String(prefs.volume));
  } catch {
    // Persistência é bônus; a preferência ainda vale pra sessão atual.
  }
}

export function setSoundMuted(muted: boolean) {
  prefs = { ...prefs, muted };
  persist();
  emit();
}

export function setSoundVolume(volume: number) {
  prefs = { ...prefs, volume: Math.min(Math.max(volume, 0), 1) };
  persist();
  emit();
}

/** Leitura direta, pra quem não é componente (o tocador de som). */
export function getSoundPrefs(): SoundPrefs {
  return prefs;
}

export function useSoundPrefs(): SoundPrefs {
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
