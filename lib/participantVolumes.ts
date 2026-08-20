// Regras de volume da chamada, sem React e sem LiveKit — só números e
// localStorage. Quem aplica isso nas tracks é o <VolumeMixerBinder />; quem
// desenha os sliders é o ParticipantAudioPanel e a janela de configurações.
//
// Estava tudo dentro de ParticipantAudioPanel.tsx, que era ao mesmo tempo o
// dono do estado, o dono da persistência e a UI. Isso tinha dois defeitos que
// só apareceram quando o volume geral e o modo foco entraram na conversa:
// o volume só era aplicado enquanto o card estava aberto, e não havia onde
// combinar "volume desta pessoa" com "volume geral" e "modo foco".

import { Track } from 'livekit-client';

/** Volume 1 = 100% (som original). Acima disso é boost. */
export const DEFAULT_VOLUME = 1;

// A API do livekit-client aceita valores acima de 1, mas isso só tem efeito
// real porque o Room usa WebAudio (`webAudioMix` nas RoomOptions, ver
// PageClientImpl). Sem isso o navegador clampa `<audio>.volume` em 1.0 e o
// boost simplesmente não acontece.
export const MAX_VOLUME = 2;

export type SourceKey = 'mic' | 'screenShareAudio' | 'soundboard';

/**
 * `soundboard` de propósito NÃO está aqui: ela não é uma track do LiveKit (o
 * som é tocado localmente por quem ouve, ver lib/soundboardEvents.ts), então
 * não há `Track.Source` pra ela. O volume dela é aplicado no player.
 */
export const LIVEKIT_SOURCE: Record<
  'mic' | 'screenShareAudio',
  Track.Source.Microphone | Track.Source.ScreenShareAudio
> = {
  mic: Track.Source.Microphone,
  screenShareAudio: Track.Source.ScreenShareAudio,
};

export interface StoredVolumeState {
  volume: Partial<Record<SourceKey, number>>;
  /** Valor de antes do mute, pra restaurar quando desmutar. */
  mutedPrevVolume: Partial<Record<SourceKey, number>>;
}

export const EMPTY_VOLUME_STATE: StoredVolumeState = { volume: {}, mutedPrevVolume: {} };

// --- Curva perceptual -------------------------------------------------------
//
// `GainNode.gain` é amplitude LINEAR, mas o ouvido percebe volume de forma
// aproximadamente logarítmica: dobrar a amplitude não soa como o dobro. Num
// slider linear quase toda a diferença audível se concentra no fim do curso.
//
// Lei de potência quadrática, a aproximação clássica de fader de mesa: ganho =
// MAX × x². Com MAX=2, o ganho unitário (0 dB) cai em x = √(1/2) ≈ 0,707, ou
// seja ~71% do curso — sobra percurso fino na região baixa, onde o ouvido
// discrimina melhor, e o trecho final vira boost até +6 dB.
//
// Guardamos e aplicamos SEMPRE o ganho linear; a curva existe só entre a
// posição do slider e esse ganho.
const CURVE_EXPONENT = 2;
export const SLIDER_STEPS = 100;

/** Posição do slider (0..SLIDER_STEPS) -> ganho linear (0..MAX_VOLUME). */
export function sliderToGain(position: number): number {
  const x = Math.min(Math.max(position / SLIDER_STEPS, 0), 1);
  return MAX_VOLUME * Math.pow(x, CURVE_EXPONENT);
}

/** Ganho linear -> posição do slider. Inversa exata de `sliderToGain`. */
export function gainToSlider(gain: number): number {
  const x = Math.min(Math.max(gain / MAX_VOLUME, 0), 1);
  return Math.pow(x, 1 / CURVE_EXPONENT) * SLIDER_STEPS;
}

/** Rótulo curto em dB: "0 dB", "+4.1 dB", "−8.5 dB", "−∞". */
export function formatDb(gain: number): string {
  if (gain <= 0) return '−∞';
  const db = 20 * Math.log10(gain);
  if (Math.abs(db) < 0.05) return '0 dB';
  return `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
}

/**
 * A regra do mixer, num lugar só.
 *
 * O modo foco é uma MÁSCARA MULTIPLICATIVA: ele nunca escreve no volume
 * individual. É isso que faz desligar o foco devolver exatamente os volumes de
 * antes, sem precisar guardar nada pra restaurar depois.
 */
export function effectiveGain(input: {
  individual: number;
  master: number;
  focusMuted: boolean;
}): number {
  if (input.focusMuted) {
    return 0;
  }
  // Clamp no PRODUTO, não no que é armazenado: master 100% + individual 200%
  // não pode virar 400% e estourar o alto-falante de alguém.
  return Math.min(input.individual * input.master, MAX_VOLUME);
}

// --- Persistência -----------------------------------------------------------
//
// CHAVE POR `name`, NUNCA POR `identity`. A identity carrega o sufixo aleatório
// `${username}__${randomString(4)}` (ver connection-details/route.ts) que muda
// a CADA conexão — a versão anterior deste código guardava por identity, o que
// significava que o volume "persistido" nunca era reencontrado e o localStorage
// só acumulava chaves mortas. `participant.name` é o username limpo, o mesmo
// critério que useMembersAvatarMap já usa pelo mesmo motivo.
const VOLUME_PREFIX = 'concord:participant-volume:';
const MASTER_KEY = 'concord:master-volume';
const OUTPUT_DEVICE_KEY = 'concord:output-device';

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Modo privado, quota etc. Persistência é bônus, não quebra a UI.
  }
}

export function loadParticipantVolume(name: string): StoredVolumeState {
  const parsed = readJson<Partial<StoredVolumeState>>(`${VOLUME_PREFIX}${name}`, {});
  return { volume: parsed.volume ?? {}, mutedPrevVolume: parsed.mutedPrevVolume ?? {} };
}

export function saveParticipantVolume(name: string, state: StoredVolumeState): void {
  writeJson(`${VOLUME_PREFIX}${name}`, state);
}

export function loadMasterVolume(): number {
  const value = readJson<number>(MASTER_KEY, DEFAULT_VOLUME);
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), MAX_VOLUME)
    : DEFAULT_VOLUME;
}

export function saveMasterVolume(value: number): void {
  writeJson(MASTER_KEY, value);
}

export function loadOutputDeviceId(): string | null {
  return readJson<string | null>(OUTPUT_DEVICE_KEY, null);
}

export function saveOutputDeviceId(deviceId: string | null): void {
  writeJson(OUTPUT_DEVICE_KEY, deviceId);
}
