'use client';

import * as React from 'react';
import {
  DEFAULT_NOISE_LEVEL,
  levelToDenoiseModel,
  loadNoiseLevelPref,
  saveNoiseLevelPref,
  type DenoiseModel,
  type NoiseLevel,
} from './denoise';
import type { DenoiseStatus } from './micProcessor';
import {
  DEFAULT_GATE_THRESHOLD,
  DEFAULT_INPUT_GAIN,
  loadGateThresholdPref,
  loadInputGainPref,
  saveGateThresholdPref,
  saveInputGainPref,
} from './micProcessor';
import type { NoiseSuppressionTier } from './noiseSuppression';

// ---------------------------------------------------------------------------
// Estado de audio do microfone, compartilhado entre duas arvores de React.
// ---------------------------------------------------------------------------
//
// O problema que este contexto resolve: os controles de audio moram no painel
// de configuracoes da `ChannelSidebar`, que e IRMÃ do `PageClientImpl` dentro
// do `RoomShell` — ou seja, fora do `RoomContext.Provider` do LiveKit. Lá não
// existe `useRoomContext()` nem `useLocalParticipant()`.
//
// E tem um segundo problema, mais sutil: o processor precisa continuar
// aplicado ao microfone o tempo todo, mas o painel abre e fecha. Se a UI fosse
// dona do processor (como era antes, no `MicGateControl`), fechar o painel
// desmontaria a cadeia de audio e o gate pararia de funcionar.
//
// Daí a divisão:
//
//   RoomShell
//     └─ <MicProcessorProvider>        ← o estado mora aqui, acima dos dois lados
//          ├─ ChannelSidebar → SettingsPanel   (UI burra: le e escreve o estado)
//          └─ PageClientImpl
//               └─ RoomContext.Provider
//                    └─ <MicProcessorBinder />  ← dono do processor, sem UI
//
// O binder é quem conhece a track e o LiveKit; o painel só mexe em números.

export interface MicProcessorBinding {
  applyThreshold: (value: number) => void;
  /** Ganho de entrada (pre-amplificador). Recebe tambem se o controle
   * automatico de ganho do navegador deve ficar ligado: os dois BRIGAM — o AGC
   * desfaz o que voce ajusta na mao — entao quem aplica precisa saber os dois
   * ao mesmo tempo, pelo mesmo motivo do applyNoiseLevel logo abaixo. */
  applyInputGain: (value: number, autoGainControl: boolean) => void;
  /** Recebe os DOIS valores de uma vez, nunca um de cada vez: as duas camadas
   * sao interdependentes (com modelo neural ativo a supressao nativa e
   * desligada), e aplicar em duas chamadas separadas deixaria um instante com
   * a combinacao errada — ou pior, leria estado ainda nao re-renderizado. */
  applyNoiseLevel: (model: DenoiseModel, browserEnabled: boolean) => void;
}

interface ReportedState {
  /** Ha uma track de microfone publicada com o processor aplicado. */
  active: boolean;
  denoiseStatus: DenoiseStatus;
  browserTier: NoiseSuppressionTier;
  monitorDevice: boolean;
  processorFailed: boolean;
}

export interface MicProcessorContextValue extends ReportedState {
  threshold: number;
  noiseLevel: NoiseLevel;
  /** Ganho de entrada linear (1 = sem alteracao). */
  inputGain: number;
  /** Controle automatico de ganho do NAVEGADOR. Ligado por padrao; mexer no
   * ganho manual desliga (ver setInputGain). */
  autoGainControl: boolean;
  setThreshold: (value: number) => void;
  setNoiseLevel: (level: NoiseLevel) => void;
  setInputGain: (value: number) => void;
  setAutoGainControl: (enabled: boolean) => void;
  /** Nivel do microfone ao vivo, pro medidor. Fora do estado do React de
   * proposito: chega a ~33Hz (ver TICK_MS em micProcessor.ts) e re-renderizar
   * a arvore nessa cadencia seria desperdicio puro. */
  subscribeLevel: (listener: (levelDb: number) => void) => () => void;
}

const MicProcessorContext = React.createContext<MicProcessorContextValue | null>(null);

/** Canal privado entre o provider e o binder. Separado do contexto publico pra
 * a UI nao ter como mexer no ciclo de vida do processor por engano. */
interface MicProcessorInternals {
  register: (binding: MicProcessorBinding | null) => void;
  report: (patch: Partial<ReportedState>) => void;
  emitLevel: (levelDb: number) => void;
  /** Valores desejados no momento — o binder lê isso ao aplicar o processor
   * numa track nova, sem depender de re-render. */
  desired: React.MutableRefObject<{
    threshold: number;
    noiseLevel: NoiseLevel;
    inputGain: number;
    autoGainControl: boolean;
  }>;
  /** Usado quando o proprio binder decide mudar a preferencia — hoje, o
   * desligamento automatico em device "Monitor of ..." (ver MicProcessorBinder). */
  override: (patch: { threshold?: number; noiseLevel?: NoiseLevel }) => void;
}

const MicProcessorInternalsContext = React.createContext<MicProcessorInternals | null>(null);

export function MicProcessorProvider(props: { children: React.ReactNode }) {
  const [threshold, setThresholdState] = React.useState<number>(DEFAULT_GATE_THRESHOLD);
  const [noiseLevel, setNoiseLevelState] = React.useState<NoiseLevel>(DEFAULT_NOISE_LEVEL);
  const [inputGain, setInputGainState] = React.useState<number>(DEFAULT_INPUT_GAIN);
  // Nao persistido em chave propria: e derivado do ganho manual (ver
  // setInputGain). Quem carrega uma preferencia de ganho != 1 ja quis o AGC
  // desligado da vez passada.
  const [autoGainControl, setAutoGainControlState] = React.useState(true);
  const [reported, setReported] = React.useState<ReportedState>({
    active: false,
    denoiseStatus: 'off',
    browserTier: 'unavailable',
    monitorDevice: false,
    processorFailed: false,
  });

  // As prefs vivem no localStorage, que nao existe no servidor. Ler no primeiro
  // efeito (em vez de no inicializador do useState) mantem o HTML do servidor
  // igual ao da primeira renderizacao do cliente, sem erro de hidratacao.
  React.useEffect(() => {
    setThresholdState(loadGateThresholdPref());
    setNoiseLevelState(loadNoiseLevelPref());
    const gain = loadInputGainPref();
    setInputGainState(gain);
    setAutoGainControlState(gain === DEFAULT_INPUT_GAIN);
  }, []);

  const bindingRef = React.useRef<MicProcessorBinding | null>(null);
  const listenersRef = React.useRef(new Set<(levelDb: number) => void>());
  const desired = React.useRef({ threshold, noiseLevel, inputGain, autoGainControl });
  desired.current = { threshold, noiseLevel, inputGain, autoGainControl };

  const setThreshold = React.useCallback((value: number) => {
    setThresholdState(value);
    saveGateThresholdPref(value);
    bindingRef.current?.applyThreshold(value);
  }, []);

  const setNoiseLevel = React.useCallback((level: NoiseLevel) => {
    setNoiseLevelState(level);
    saveNoiseLevelPref(level);
    bindingRef.current?.applyNoiseLevel(levelToDenoiseModel(level), level !== 'off');
  }, []);

  const setInputGain = React.useCallback((value: number) => {
    setInputGainState(value);
    saveInputGainPref(value);
    // Ganho manual e AGC do navegador brigam: o AGC normaliza o nivel e desfaz
    // o ajuste, deixando o slider com cara de placebo. Sair do valor neutro
    // desliga o automatico; voltar pra 1 devolve o controle pro navegador. A
    // UI diz isso em texto, pra ninguem ter que descobrir sozinho.
    const auto = value === DEFAULT_INPUT_GAIN;
    setAutoGainControlState(auto);
    bindingRef.current?.applyInputGain(value, auto);
  }, []);

  const setAutoGainControl = React.useCallback((enabled: boolean) => {
    setAutoGainControlState(enabled);
    bindingRef.current?.applyInputGain(desired.current.inputGain, enabled);
  }, []);

  const subscribeLevel = React.useCallback((listener: (levelDb: number) => void) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const internals = React.useMemo<MicProcessorInternals>(
    () => ({
      register: (binding) => {
        bindingRef.current = binding;
      },
      report: (patch) => {
        setReported((prev) => {
          // Comparação rasa antes de setar: o binder reporta a cada publish de
          // track e a cada mudança de status, e a maioria dessas chamadas não
          // muda nada. Sem isso, re-render à toa em toda a árvore.
          let changed = false;
          for (const key of Object.keys(patch) as (keyof ReportedState)[]) {
            if (prev[key] !== patch[key]) {
              changed = true;
              break;
            }
          }
          return changed ? { ...prev, ...patch } : prev;
        });
      },
      emitLevel: (levelDb) => {
        for (const listener of listenersRef.current) {
          listener(levelDb);
        }
      },
      desired,
      override: (patch) => {
        if (patch.threshold !== undefined) {
          setThresholdState(patch.threshold);
          saveGateThresholdPref(patch.threshold);
          bindingRef.current?.applyThreshold(patch.threshold);
        }
        if (patch.noiseLevel !== undefined) {
          const level = patch.noiseLevel;
          setNoiseLevelState(level);
          saveNoiseLevelPref(level);
          bindingRef.current?.applyNoiseLevel(levelToDenoiseModel(level), level !== 'off');
        }
      },
    }),
    [],
  );

  const value = React.useMemo<MicProcessorContextValue>(
    () => ({
      ...reported,
      threshold,
      noiseLevel,
      inputGain,
      autoGainControl,
      setThreshold,
      setNoiseLevel,
      setInputGain,
      setAutoGainControl,
      subscribeLevel,
    }),
    [
      reported,
      threshold,
      noiseLevel,
      inputGain,
      autoGainControl,
      setThreshold,
      setNoiseLevel,
      setInputGain,
      setAutoGainControl,
      subscribeLevel,
    ],
  );

  return (
    <MicProcessorInternalsContext.Provider value={internals}>
      <MicProcessorContext.Provider value={value}>{props.children}</MicProcessorContext.Provider>
    </MicProcessorInternalsContext.Provider>
  );
}

/** Estado de audio pra UI. Retorna `null` fora do provider — a home e o painel
 * de admin renderizam a `ChannelSidebar` sem ele, e nesses lugares a seção de
 * áudio simplesmente não aparece. */
export function useMicProcessor(): MicProcessorContextValue | null {
  return React.useContext(MicProcessorContext);
}

export function useMicProcessorInternals(): MicProcessorInternals | null {
  return React.useContext(MicProcessorInternalsContext);
}
