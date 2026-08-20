'use client';

// Dono único dos volumes da chamada: volume por pessoa, volume geral (master),
// modo foco e dispositivo de saída.
//
// POR QUE EXISTE
// --------------
// Mesmo desenho do MicProcessorContext e do CallStateContext (leia os dois
// antes de mexer aqui): os sliders moram na `ChannelSidebar` / janela de
// configurações, que é IRMÃ do `PageClientImpl` e portanto está FORA do
// `RoomContext` — lá não existe `useRoomContext()` nem `remoteParticipants`.
// O provider fica acima dos dois ramos e um binder headless dentro do
// `RoomContext` aplica de fato.
//
//   RoomShell
//     └─ <VolumeMixerProvider>
//          ├─ ChannelSidebar → SettingsWindow    (UI: só mexe em números)
//          └─ PageClientImpl
//               └─ RoomContext.Provider
//                    └─ <VolumeMixerBinder />    (chama setVolume, sem UI)
//
// E resolve dois defeitos que existiam antes: o volume salvo só era aplicado
// enquanto o card de volume estava aberto, e não havia onde combinar volume
// individual com master e modo foco.

import * as React from 'react';
import {
  DEFAULT_VOLUME,
  EMPTY_VOLUME_STATE,
  loadMasterVolume,
  loadOutputDeviceId,
  loadParticipantVolume,
  saveMasterVolume,
  saveOutputDeviceId,
  saveParticipantVolume,
  type SourceKey,
  type StoredVolumeState,
} from './participantVolumes';

export interface FocusState {
  enabled: boolean;
  /** Usernames que continuo ouvindo. Vazio + ligado = silêncio total. */
  allowed: ReadonlySet<string>;
}

export interface VolumeMixerValue {
  master: number;
  setMaster: (value: number) => void;

  /** Estado salvo de uma pessoa (por `participant.name`). */
  volumeStateFor: (name: string) => StoredVolumeState;
  /** Volume individual de uma fonte. 1 = 100%. */
  volumeFor: (name: string, source: SourceKey) => number;
  setVolume: (name: string, source: SourceKey, value: number) => void;
  /** Alterna mute individual, restaurando o volume de antes. */
  toggleMute: (name: string, source: SourceKey) => void;

  focus: FocusState;
  toggleFocus: () => void;
  setFocusAllowed: (names: ReadonlySet<string>) => void;
  /** A pergunta que o binder, os tiles e a soundboard fazem. */
  isFocusMuted: (name: string) => boolean;
  /** Quem eu mutei individualmente (so a VOZ). Anunciado pra sala pelo binder,
   * pra pessoa saber que nao esta sendo ouvida — ver lib/audibility.ts. */
  mutedNames: ReadonlySet<string>;

  outputDeviceId: string | null;
  setOutputDeviceId: (deviceId: string | null) => void;

  /** Chamado pelo binder quando vê uma pessoa nova, pra hidratar do storage. */
  ensureLoaded: (name: string) => void;
}

const VolumeMixerContext = React.createContext<VolumeMixerValue | null>(null);

export function VolumeMixerProvider({ children }: { children: React.ReactNode }) {
  // Todos os estados nascem com o default e só leem o localStorage num efeito.
  // O inicializador de `useState` roda também no SSR, onde não existe
  // localStorage — ler ali daria divergência de hidratação. Mesmo padrão do
  // MicProcessorProvider e do usePersistedSize.
  const [master, setMasterState] = React.useState(DEFAULT_VOLUME);
  const [outputDeviceId, setOutputDeviceIdState] = React.useState<string | null>(null);
  const [volumes, setVolumes] = React.useState<Record<string, StoredVolumeState>>({});
  const [focus, setFocus] = React.useState<FocusState>({
    enabled: false,
    allowed: new Set<string>(),
  });

  React.useEffect(() => {
    setMasterState(loadMasterVolume());
    setOutputDeviceIdState(loadOutputDeviceId());
  }, []);

  const setMaster = React.useCallback((value: number) => {
    setMasterState(value);
    // Aplicar é barato (é só gain), persistir a cada pixel do arrasto não é —
    // mas `localStorage.setItem` de um número também não justifica debounce
    // com timer e cleanup. Escrevemos direto; se algum dia virar problema, o
    // lugar de mexer é aqui.
    saveMasterVolume(value);
  }, []);

  const setOutputDeviceId = React.useCallback((deviceId: string | null) => {
    setOutputDeviceIdState(deviceId);
    saveOutputDeviceId(deviceId);
  }, []);

  const ensureLoaded = React.useCallback((name: string) => {
    setVolumes((prev) => (name in prev ? prev : { ...prev, [name]: loadParticipantVolume(name) }));
  }, []);

  const volumeStateFor = React.useCallback(
    (name: string): StoredVolumeState => volumes[name] ?? EMPTY_VOLUME_STATE,
    [volumes],
  );

  const volumeFor = React.useCallback(
    (name: string, source: SourceKey): number => volumes[name]?.volume[source] ?? DEFAULT_VOLUME,
    [volumes],
  );

  const updateStored = React.useCallback(
    (name: string, mutate: (prev: StoredVolumeState) => StoredVolumeState) => {
      setVolumes((prev) => {
        const current = prev[name] ?? loadParticipantVolume(name);
        const next = mutate(current);
        saveParticipantVolume(name, next);
        return { ...prev, [name]: next };
      });
    },
    [],
  );

  const setVolume = React.useCallback(
    (name: string, source: SourceKey, value: number) => {
      updateStored(name, (prev) => ({
        ...prev,
        volume: { ...prev.volume, [source]: value },
      }));
    },
    [updateStored],
  );

  const toggleMute = React.useCallback(
    (name: string, source: SourceKey) => {
      updateStored(name, (prev) => {
        const current = prev.volume[source] ?? DEFAULT_VOLUME;
        if (current === 0) {
          // Desmutando: volta pro valor de antes (ou 100% se não houver).
          const restored = prev.mutedPrevVolume[source] ?? DEFAULT_VOLUME;
          return {
            volume: { ...prev.volume, [source]: restored === 0 ? DEFAULT_VOLUME : restored },
            mutedPrevVolume: { ...prev.mutedPrevVolume, [source]: undefined },
          };
        }
        return {
          volume: { ...prev.volume, [source]: 0 },
          mutedPrevVolume: { ...prev.mutedPrevVolume, [source]: current },
        };
      });
    },
    [updateStored],
  );

  const toggleFocus = React.useCallback(() => {
    setFocus((prev) => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const setFocusAllowed = React.useCallback((names: ReadonlySet<string>) => {
    setFocus((prev) => ({ ...prev, allowed: new Set(names) }));
  }, []);

  const isFocusMuted = React.useCallback(
    (name: string) => focus.enabled && !focus.allowed.has(name),
    [focus],
  );

  const mutedNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const [name, state] of Object.entries(volumes)) {
      if (state.volume.mic === 0) {
        names.add(name);
      }
    }
    return names;
  }, [volumes]);

  const value = React.useMemo<VolumeMixerValue>(
    () => ({
      master,
      setMaster,
      volumeStateFor,
      volumeFor,
      setVolume,
      toggleMute,
      focus,
      toggleFocus,
      setFocusAllowed,
      isFocusMuted,
      mutedNames,
      outputDeviceId,
      setOutputDeviceId,
      ensureLoaded,
    }),
    [
      master,
      setMaster,
      volumeStateFor,
      volumeFor,
      setVolume,
      toggleMute,
      focus,
      toggleFocus,
      setFocusAllowed,
      isFocusMuted,
      mutedNames,
      outputDeviceId,
      setOutputDeviceId,
      ensureLoaded,
    ],
  );

  return <VolumeMixerContext.Provider value={value}>{children}</VolumeMixerContext.Provider>;
}

/**
 * `null` fora do provider (home e canais de texto, onde não há chamada). Quem
 * consome precisa tratar esse caso — a `ChannelSidebar` renderiza nos dois
 * lugares.
 */
export function useVolumeMixer(): VolumeMixerValue | null {
  return React.useContext(VolumeMixerContext);
}

/**
 * O modo foco NÃO é persistido entre sessões, de propósito: voltar amanhã sem
 * ouvir ninguém por causa de um botão apertado ontem é o pior defeito possível
 * dessa feature. Ele sempre nasce desligado. Volume individual, master e
 * dispositivo de saída, esses sim, persistem.
 */
export const FOCUS_IS_NOT_PERSISTED = true;
