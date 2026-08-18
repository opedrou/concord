import { ScreenSharePresets, VideoPreset } from 'livekit-client';

/**
 * Qualidade da transmissao de tela, escolhida pela pessoa que compartilha.
 *
 * O preset NAO pode ser trocado por `RoomOptions.publishDefaults` depois que o
 * Room ja foi construido — por isso a escolha e aplicada por publicacao, via
 * `publishOptions.videoEncoding` no wrapper de `setScreenShareEnabled`.
 *
 * Cuidado que vale lembrar: o bitrate aqui e do LADO DE QUEM ENVIA. O link de
 * subida de casa e o gargalo conhecido do projeto (ver HANDOFF), entao subir
 * pra "maxima" sem banda de upload sobrando piora a experiencia de todo mundo
 * em vez de melhorar — o SFU nao inventa banda que nao existe.
 */
export type QualityKey = 'economica' | 'media' | 'alta' | 'maxima';

interface QualityOption {
  key: QualityKey;
  /** Rotulo curto pro dropdown. */
  label: string;
  /** Explicacao mostrada no title/aria. */
  hint: string;
  preset: VideoPreset;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  {
    key: 'economica',
    label: '720p · 15fps',
    hint: 'Econômica — 1,5 Mbps. Pra internet fraca ou quando o importante é só acompanhar.',
    preset: ScreenSharePresets.h720fps15,
  },
  {
    key: 'media',
    label: '720p · 30fps',
    hint: 'Média — 2 Mbps. Movimento fluido em resolução menor; boa pra jogo com upload limitado.',
    preset: ScreenSharePresets.h720fps30,
  },
  {
    key: 'alta',
    label: '1080p · 30fps',
    hint: 'Alta — 5 Mbps. Padrão do Concord: nítido e fluido pra acompanhar jogo.',
    preset: ScreenSharePresets.h1080fps30,
  },
  {
    key: 'maxima',
    label: 'Original · 30fps',
    hint: 'Máxima — 7 Mbps, sem redimensionar. Só vale se você tiver bastante upload sobrando.',
    preset: ScreenSharePresets.original,
  },
];

/** Padrao = o preset que o projeto ja usava antes do dropdown existir. */
export const DEFAULT_QUALITY: QualityKey = 'alta';

const STORAGE_KEY = 'concord-screenshare-quality';

export function loadQualityPref(): QualityKey {
  if (typeof window === 'undefined') return DEFAULT_QUALITY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && QUALITY_OPTIONS.some((o) => o.key === raw)) {
      return raw as QualityKey;
    }
  } catch {
    // localStorage pode falhar (modo privado, quota). Cai no padrao.
  }
  return DEFAULT_QUALITY;
}

export function saveQualityPref(key: QualityKey) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // idem: persistencia e bonus, nao quebra a UI.
  }
}

export function findQuality(key: QualityKey): QualityOption {
  return QUALITY_OPTIONS.find((o) => o.key === key) ?? QUALITY_OPTIONS[2];
}

/** Encoding pronto pra ir em `publishOptions.videoEncoding`. */
export function encodingFor(key: QualityKey) {
  return findQuality(key).preset.encoding;
}
