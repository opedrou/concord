// O import do @sapphi-red/web-noise-suppressor e DINAMICO, dentro das funcoes
// assincronas la embaixo. Ele nao pode ser estatico: o modulo declara
// `class RnnoiseWorkletNode extends AudioWorkletNode` no topo, e `extends` e
// avaliado na hora em que o modulo carrega — no Node, durante o prerender das
// paginas do Next, `AudioWorkletNode` nao existe e o build quebra com
// "AudioWorkletNode is not defined". Carregar sob demanda tambem evita mandar
// esse codigo pra quem nunca liga a reducao de ruido.

// ---------------------------------------------------------------------------
// Reducao de ruido por rede neural, rodando no navegador de quem fala.
// ---------------------------------------------------------------------------
//
// Motivo de existir: nem `noiseSuppression` nem `voiceIsolation` do navegador
// (ver lib/noiseSuppression.ts) removem barulho de TECLADO. As duas foram
// feitas pra ruido estacionario — ventoinha, chiado, ar-condicionado. Clique
// de tecla e transiente e passa reto. O noise gate (lib/micProcessor.ts) so
// corta o silencio ENTRE as falas: enquanto a pessoa fala e digita ao mesmo
// tempo, o gate esta aberto e o teclado vai junto.
//
// Modelo neural resolve isso porque decide quadro a quadro (10ms) o quanto de
// cada banda de frequencia e voz e o quanto e ruido, em vez de aprender um
// perfil fixo de ruido de fundo.
//
// Krisp (@livekit/krisp-noise-filter, ainda no package.json) NAO serve: so
// funciona no LiveKit Cloud, e esta instancia e self-hosted. Daí rodar o
// modelo por conta propria, em WASM, servido do nosso proprio /public — sem
// nuvem de terceiro e sem nada pra instalar do lado de quem entra na call.

/** Modelo neural em uso. `off` = nenhuma rede rodando. */
export type DenoiseModel = 'off' | 'rnnoise' | 'gtcrn';

/**
 * O que a pessoa escolhe na UI: uma escala unica, do mais leve pro mais forte,
 * em vez de dois controles independentes.
 *
 * A escala e unica de proposito. As camadas nao se somam — com um modelo
 * neural ativo a supressao do navegador e DESLIGADA (filtrar duas vezes o
 * mesmo sinal produz artefato metalico, ver buildAudioCaptureConstraints).
 * Dois toggles separados dariam quatro combinacoes, das quais tres sao ruins.
 *
 *  - `off`      nenhuma reducao de ruido
 *  - `browser`  so as constraints nativas (noiseSuppression/voiceIsolation)
 *  - `rnnoise`  rede neural leve, no lugar das nativas
 *  - `gtcrn`    rede neural pesada, no lugar das nativas
 */
export type NoiseLevel = 'off' | 'browser' | 'rnnoise' | 'gtcrn';

export const NOISE_LEVEL_STORAGE_KEY = 'concord-denoise-model';

/** Padrao: RNNoise. Barata (1-3% de CPU) e com anos de rodagem em producao no
 * Jitsi Meet. GTCRN e melhor mas mais pesada — fica como escolha explicita. */
export const DEFAULT_NOISE_LEVEL: NoiseLevel = 'rnnoise';

export const NOISE_LEVELS: NoiseLevel[] = ['off', 'browser', 'rnnoise', 'gtcrn'];

function isNoiseLevel(value: string | null): value is NoiseLevel {
  return value === 'off' || value === 'browser' || value === 'rnnoise' || value === 'gtcrn';
}

export function levelToDenoiseModel(level: NoiseLevel): DenoiseModel {
  return level === 'rnnoise' || level === 'gtcrn' ? level : 'off';
}

export function loadNoiseLevelPref(): NoiseLevel {
  if (typeof window === 'undefined') {
    return DEFAULT_NOISE_LEVEL;
  }
  try {
    const raw = window.localStorage.getItem(NOISE_LEVEL_STORAGE_KEY);
    return isNoiseLevel(raw) ? raw : DEFAULT_NOISE_LEVEL;
  } catch {
    return DEFAULT_NOISE_LEVEL;
  }
}

export function saveNoiseLevelPref(level: NoiseLevel) {
  try {
    window.localStorage.setItem(NOISE_LEVEL_STORAGE_KEY, level);
  } catch {
    // localStorage pode falhar (modo privado, quota) — a escolha vale so pra
    // sessao atual, sem quebrar nada. Mesmo tratamento das outras prefs.
  }
}

export function noiseLevelLabel(level: NoiseLevel): string {
  switch (level) {
    case 'browser':
      return 'Navegador';
    case 'rnnoise':
      return 'RNNoise';
    case 'gtcrn':
      return 'Máxima';
    case 'off':
    default:
      return 'Desligada';
  }
}

export function noiseLevelDescription(level: NoiseLevel): string {
  switch (level) {
    case 'browser':
      return 'Supressão nativa do navegador. Boa para ruído constante (ventoinha, chiado), não pega teclado.';
    case 'rnnoise':
      return 'Rede neural leve. Remove teclado, mouse e batidas na mesa. Custa 1–3% de CPU.';
    case 'gtcrn':
      return 'Rede neural mais forte, melhor resultado e mais CPU. Se a máquina engasgar, volte para RNNoise.';
    case 'off':
    default:
      return 'Nenhum processamento — o microfone vai cru para a chamada.';
  }
}

/**
 * Os dois modelos assumem 48kHz — nao ha reamostragem interna neles, e o
 * `RnnoiseWorkletNode` documenta isso explicitamente ("Assumes sample rate to
 * be 48kHz"). O AudioContext vem pronto do LiveKit (`webAudioMix: true`, ver
 * PageClientImpl), entao nao escolhemos a taxa: se o SO entregar 44.1kHz, a
 * camada neural fica indisponivel e caimos nas nativas. Reamostrar na mao
 * custaria latencia e qualidade pra salvar um caso raro em desktop.
 */
export const REQUIRED_SAMPLE_RATE = 48000;

export function isSampleRateSupported(ctx: BaseAudioContext): boolean {
  return ctx.sampleRate === REQUIRED_SAMPLE_RATE;
}

/** AudioWorklet e obrigatorio pros dois modelos. */
export function isAudioWorkletSupported(): boolean {
  return typeof AudioWorkletNode !== 'undefined';
}

const BASE_PATH = '/noise-suppressor';

// Cache por (modelo, AudioContext). O binario WASM e o `addModule` sao caros e
// nao mudam: buscar de novo a cada troca de modelo ou de microfone seria
// desperdicio puro. `addModule` e por-contexto (o registro do processor vive
// no AudioWorkletGlobalScope daquele contexto), entao a chave precisa incluir
// o contexto — daí o WeakMap externo, que ainda deixa o contexto ser coletado
// quando a call acaba.
const prepared = new WeakMap<BaseAudioContext, Map<DenoiseModel, Promise<ArrayBuffer>>>();

function prepare(ctx: AudioContext, model: Exclude<DenoiseModel, 'off'>): Promise<ArrayBuffer> {
  let byModel = prepared.get(ctx);
  if (!byModel) {
    byModel = new Map();
    prepared.set(ctx, byModel);
  }
  const cached = byModel.get(model);
  if (cached) {
    return cached;
  }

  const task = (async () => {
    const lib = await import('@sapphi-red/web-noise-suppressor');
    if (model === 'rnnoise') {
      // `loadRnnoise` detecta suporte a SIMD sozinho (wasm-feature-detect) e
      // escolhe o binario certo — por isso as duas URLs.
      const [binary] = await Promise.all([
        lib.loadRnnoise({
          url: `${BASE_PATH}/rnnoise.wasm`,
          simdUrl: `${BASE_PATH}/rnnoise_simd.wasm`,
        }),
        ctx.audioWorklet.addModule(`${BASE_PATH}/rnnoiseWorklet.js`),
      ]);
      return binary;
    }
    const [binary] = await Promise.all([
      lib.loadGtcrn({ url: `${BASE_PATH}/gtcrn.wasm` }),
      ctx.audioWorklet.addModule(`${BASE_PATH}/gtcrnWorklet.js`),
    ]);
    return binary;
  })();

  // Nao cacheia falha: se a rede caiu no meio do fetch do wasm, a proxima
  // tentativa (a pessoa clicando de novo no seletor) tem que poder dar certo.
  task.catch(() => {
    byModel?.delete(model);
  });

  byModel.set(model, task);
  return task;
}

/** Nó de denoise pronto pra entrar na cadeia. `destroy()` libera a instancia
 * WASM do lado do worklet — só `disconnect()` deixaria ela viva. */
export interface DenoiseNode {
  node: AudioNode;
  destroy: () => void;
}

/**
 * Cria o nó do modelo pedido. Lanca se o WASM/worklet falhar ao carregar — quem
 * chama trata caindo pras camadas nativas (ver lib/micProcessor.ts).
 *
 * `maxChannels: 1` porque microfone e mono na pratica e a cadeia toda a
 * jusante (analyser do gate, GainNode) trabalha assim; pedir 2 so faria o
 * modelo rodar duas vezes por quadro à toa.
 */
export async function createDenoiseNode(
  ctx: AudioContext,
  model: Exclude<DenoiseModel, 'off'>,
): Promise<DenoiseNode> {
  const [wasmBinary, lib] = await Promise.all([
    prepare(ctx, model),
    import('@sapphi-red/web-noise-suppressor'),
  ]);
  if (model === 'rnnoise') {
    const node = new lib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    return { node, destroy: () => node.destroy() };
  }
  const node = new lib.GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary });
  return { node, destroy: () => node.destroy() };
}
