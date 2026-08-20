import type { AudioCaptureOptions } from 'livekit-client';

// A preferencia de reducao de ruido nao mora mais aqui: virou uma escala unica
// (desligada / navegador / RNNoise / GTCRN), persistida em lib/denoise.ts como
// `NoiseLevel`. Este arquivo cuida so das camadas NATIVAS do navegador.

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
 * sozinho).
 *
 * Estas sao as camadas NATIVAS, boas pra ruido estacionario (ventoinha,
 * chiado) e inuteis contra teclado. A camada que resolve teclado é a neural,
 * em lib/denoise.ts — WASM proprio servido do nosso /public, ja que
 * `@livekit/krisp-noise-filter` so funciona no LiveKit Cloud e
 * `@livekit/track-processors` (0.7.0) so tem processadores de VIDEO.
 */
export function getSupportedNoiseConstraints(): SupportedNoiseConstraints {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getSupportedConstraints) {
    return {
      noiseSuppression: false,
      voiceIsolation: false,
      echoCancellation: false,
      autoGainControl: false,
    };
  }
  const supported =
    navigator.mediaDevices.getSupportedConstraints() as ExtendedSupportedConstraints;
  return {
    noiseSuppression: !!supported.noiseSuppression,
    voiceIsolation: !!supported.voiceIsolation,
    echoCancellation: !!supported.echoCancellation,
    autoGainControl: !!supported.autoGainControl,
  };
}

/**
 * Constraints de audio a pedir na captura.
 *
 * `neuralActive` = a camada de rede neural (RNNoise/GTCRN, ver lib/denoise.ts)
 * esta processando a track. Nesse caso a supressao do NAVEGADOR e desligada de
 * proposito: filtrar duas vezes o mesmo sinal produz artefato metalico, e o
 * modelo neural ja faz um trabalho melhor que a camada nativa. O que continua
 * ligado é `echoCancellation` e `autoGainControl` — nenhum dos dois modelos faz
 * cancelamento de eco nem controle de ganho, então essas duas ainda são
 * responsabilidade do navegador.
 */
export function buildAudioCaptureConstraints(
  enabled: boolean,
  neuralActive = false,
  // Controle automatico de ganho do navegador. Fica ligado por padrao (era o
  // unico comportamento antes de existir ganho manual), mas o ganho de entrada
  // ajustavel BRIGA com ele: o AGC normaliza o nivel e desfaz o ajuste, o que
  // faz o slider parecer quebrado. Ver setInputGain em MicProcessorContext.
  autoGainControl = true,
): AudioCaptureOptions {
  if (!enabled) {
    // Desligado explicitamente — nao pede nenhuma das constraints. Importante
    // pro workaround de audio de jogo do HANDOFF (capturar "Monitor of ..."
    // como microfone): reducao de ruido agressiva mutila esse audio, entao
    // quem usa esse truque pode desligar aqui sem perder mais nada.
    return {};
  }
  const supported = getSupportedNoiseConstraints();
  return {
    noiseSuppression: neuralActive ? false : supported.noiseSuppression ? true : undefined,
    voiceIsolation: neuralActive ? false : supported.voiceIsolation ? true : undefined,
    echoCancellation: supported.echoCancellation ? true : undefined,
    autoGainControl: supported.autoGainControl ? autoGainControl : undefined,
  } as AudioCaptureOptions;
}

/**
 * Detecta o device "Monitor of ..." do PipeWire (workaround do HANDOFF secao
 * 4 pra levar audio de jogo pelo canal de voz no Linux). Compartilhado com
 * `lib/micProcessor.ts`: tanto a reducao de ruido quanto o gate de sensibilidade
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

/** Rotulo curto da camada nativa — quem monta a frase em volta e a UI. */
export function tierLabel(tier: NoiseSuppressionTier): string {
  switch (tier) {
    case 'advanced':
      return 'isolamento de voz do navegador';
    case 'browser':
      return 'supressão do navegador';
    case 'unavailable':
      return 'indisponível neste navegador';
    case 'off':
    default:
      return 'desligada';
  }
}
