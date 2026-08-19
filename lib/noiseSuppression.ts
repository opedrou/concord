import type { AudioCaptureOptions } from 'livekit-client';

// Preferencia do usuario (liga/desliga a camada de reducao de ruido como um
// todo). Persistida pra sobreviver a reload/troca de canal.
export const NOISE_SUPPRESSION_STORAGE_KEY = 'concord-noise-suppression-enabled';

export function loadNoiseSuppressionPref(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(NOISE_SUPPRESSION_STORAGE_KEY);
    // Sem valor salvo ainda = default ligado (a maioria quer o mic mais limpo).
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function saveNoiseSuppressionPref(enabled: boolean) {
  try {
    window.localStorage.setItem(NOISE_SUPPRESSION_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // localStorage pode falhar (modo privado, quota etc) — a preferencia so
    // vale pra sessao atual, sem quebrar nada.
  }
}

/**
 * `voiceIsolation` e um MediaTrackConstraint mais recente (spec
 * mediacapture-extensions), mais forte que `noiseSuppression`, ainda nao
 * presente no lib.dom.d.ts do TypeScript instalado. Existe de verdade na
 * `AudioCaptureOptions` do livekit-client (ver node_modules/livekit-client/
 * dist/src/room/track/options.d.ts) e em MediaTrackSupportedConstraints de
 * navegadores que a suportam (Chrome recente) — so falta o tipo.
 */
interface ExtendedSupportedConstraints extends MediaTrackSupportedConstraints {
  voiceIsolation?: boolean;
}
interface ExtendedTrackSettings extends MediaTrackSettings {
  voiceIsolation?: boolean;
}

export interface SupportedNoiseConstraints {
  noiseSuppression: boolean;
  voiceIsolation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

/**
 * O que o NAVEGADOR diz que suporta — nao significa que vai ser aplicado de
 * fato (por isso a UI le `getSettings()` de volta em vez de confiar nisso
 * sozinho). `@livekit/track-processors` (0.7.0, ja no package.json) foi
 * conferido e so tem processadores de VIDEO (blur/virtual background via
 * mediapipe) — nao existe camada de audio nele. Krisp
 * (`@livekit/krisp-noise-filter`) so funciona no LiveKit Cloud, nao
 * self-hosted (ver HANDOFF secao 3). Por isso a "camada avancada" aqui e o
 * `voiceIsolation` nativo do navegador, nao um processador WASM proprio.
 */
export function getSupportedNoiseConstraints(): SupportedNoiseConstraints {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getSupportedConstraints) {
    return { noiseSuppression: false, voiceIsolation: false, echoCancellation: false, autoGainControl: false };
  }
  const supported = navigator.mediaDevices.getSupportedConstraints() as ExtendedSupportedConstraints;
  return {
    noiseSuppression: !!supported.noiseSuppression,
    voiceIsolation: !!supported.voiceIsolation,
    echoCancellation: !!supported.echoCancellation,
    autoGainControl: !!supported.autoGainControl,
  };
}

/** Constraints de audio a pedir na captura, de acordo com a preferencia do usuario. */
export function buildAudioCaptureConstraints(enabled: boolean): AudioCaptureOptions {
  if (!enabled) {
    // Desligado explicitamente — nao pede nenhuma das constraints. Importante
    // pro workaround de audio de jogo do HANDOFF (capturar "Monitor of ..."
    // como microfone): reducao de ruido agressiva mutila esse audio, entao
    // quem usa esse truque pode desligar aqui sem perder mais nada.
    return {};
  }
  const supported = getSupportedNoiseConstraints();
  return {
    noiseSuppression: supported.noiseSuppression ? true : undefined,
    voiceIsolation: supported.voiceIsolation ? true : undefined,
    echoCancellation: supported.echoCancellation ? true : undefined,
    autoGainControl: supported.autoGainControl ? true : undefined,
  } as AudioCaptureOptions;
}

/**
 * Detecta o device "Monitor of ..." do PipeWire (workaround do HANDOFF secao
 * 4 pra levar audio de jogo pelo canal de voz no Linux). Compartilhado com
 * `lib/micGate.ts`: tanto a reducao de ruido quanto o gate de sensibilidade
 * destroem esse audio se aplicados com força — os dois precisam da mesma
 * deteccao, entao ela mora aqui, num lugar so.
 */
export function isMonitorDevice(label: string | undefined | null): boolean {
  return /monitor of/i.test(label ?? '');
}

export type NoiseSuppressionTier = 'advanced' | 'browser' | 'unavailable' | 'off';

/** Le o que o navegador REALMENTE aplicou na track (nao o que pedimos). */
export function readAppliedTier(mst: MediaStreamTrack, enabled: boolean): NoiseSuppressionTier {
  if (!enabled) {
    return 'off';
  }
  const settings = mst.getSettings() as ExtendedTrackSettings;
  if (settings.voiceIsolation === true) {
    return 'advanced';
  }
  if (settings.noiseSuppression === true) {
    return 'browser';
  }
  return 'unavailable';
}

export function tierLabel(tier: NoiseSuppressionTier): string {
  switch (tier) {
    case 'advanced':
      return 'Redução de ruído: avançada (isolamento de voz do navegador)';
    case 'browser':
      return 'Redução de ruído: navegador';
    case 'unavailable':
      return 'Redução de ruído: indisponível neste navegador';
    case 'off':
    default:
      return 'Redução de ruído: desligada';
  }
}
