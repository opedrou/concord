import type { AudioProcessorOptions, Room, TrackProcessor } from 'livekit-client';
import { Track } from 'livekit-client';
import {
  createDenoiseNode,
  isAudioWorkletSupported,
  isSampleRateSupported,
  type DenoiseModel,
  type DenoiseNode,
} from './denoise';

// ---------------------------------------------------------------------------
// Processamento do microfone antes de publicar: reducao de ruido neural +
// sensibilidade de entrada (noise gate), estilo "Input Sensitivity" do Discord.
// ---------------------------------------------------------------------------
//
// O jeito ERRADO de fazer o gate seria ligar/desligar a track
// (`setMicrophoneEnabled`) conforme o nivel de audio: isso republica a track a
// cada vez, dispara renegociacao e faz o icone de "mutado" piscar pra todo
// mundo na sala. O caminho certo é processar o audio ANTES de publicar, via
// `LocalAudioTrack.setProcessor()` (API `@experimental` mas publica — ver
// node_modules/livekit-client/dist/src/track/processor/types.d.ts). A cadeia
// e Web Audio pura:
//
//   MediaStreamSource
//     -> [no de denoise]  (RNNoise/GTCRN em WASM, opcional — ver lib/denoise.ts)
//     -> AnalyserNode     (mede o nivel)
//     -> GainNode         (aplica o gate)
//     -> MediaStreamDestination (vira a track processada, publicada no lugar
//        da original)
//
// O denoise vem ANTES do analyser de proposito: assim o gate decide em cima do
// audio JA LIMPO. Sem isso, um clique de teclado sozinho abre o gate — que era
// exatamente um dos sintomas do problema original.
//
// Por que gate e denoise moram no MESMO processor: o LiveKit aceita um unico
// `TrackProcessor` por track, entao nao dá pra ter um objeto pra cada. Um dono
// so, uma cadeia so.
//
// O AudioContext usado é o que o proprio `setProcessor` passa em
// `opts.audioContext` — NAO criamos um novo. Esse é o mesmo AudioContext que
// o Room já mantém internamente por causa de `webAudioMix: true` (ver
// PageClientImpl.tsx e HANDOFF secao 9): quando webAudioMix está ligado, o
// Room chama `localParticipant.setAudioContext(...)`, que propaga pra
// `LocalAudioTrack.audioContext`, e é exatamente esse valor que
// `LocalTrack.setProcessor` repassa pra `processor.init()` (conferido lendo
// o bundle, `node_modules/livekit-client/dist/livekit-client.esm.mjs`,
// metodo `setProcessor` de `LocalAudioTrack`). Ou seja: reaproveitamos o
// contexto que já existia, sem abrir um terceiro `AudioContext` no processo
// (os outros dois sao o do `JoinLeaveSounds.tsx`, que é propositalmente
// isolado, e o interno de cada `useTrackVolume` no `useSpeakingIndicator.ts`
// — nenhum dos tres se toca).

/** Preferencia do usuario (0-100). 0 = gate desligado (sempre aberto). */
export const MIC_GATE_STORAGE_KEY = 'concord-mic-gate-threshold';

/** Valor minimo do slider — nesse ponto o gate fica INATIVO por completo
 * (equivalente a nao ter processor nenhum), como pedido: "precisa poder ser
 * desligado". */
export const GATE_MIN = 0;
export const GATE_MAX = 100;

/**
 * Default conservador: melhor deixar passar um pouco de ruido de fundo do
 * que cortar a voz de alguem. So um pouco acima de zero — corta apenas o
 * chao de silencio quase absoluto, quem quiser mais agressivo sobe o slider.
 */
export const DEFAULT_GATE_THRESHOLD = 12;

// Faixa de dBFS que o slider cobre. -55dB e um chao de silencio de ambiente
// domestico tipico (ventoinha, teclado ao longe); -15dB ja corta boa parte
// da fala baixa, entao e o teto — mais que isso vira "grita ou nao passa",
// agressivo demais pra um default de produto usado por gente de verdade.
const THRESHOLD_MIN_DB = -55;
const THRESHOLD_MAX_DB = -15;

// Histerese: o limiar de ABERTURA fica esse tanto de dB acima do limiar de
// FECHAMENTO (que e o que o slider mostra). Sem isso, fala baixa flutuando
// em torno do limiar faria o gate abrir/fechar em rajada (tremelique
// audivel). Mesma ideia do `useSpeakingIndicator.ts` (rise > fall), so que
// aqui em dB em vez de nivel linear 0..1.
const HYSTERESIS_DB = 6;

// Attack: quao rapido o gate ABRE quando a fala comeca. Tem que ser quase
// instantaneo — cortar a primeira silaba e o erro mais audivel que um gate
// pode cometer. 12ms e mais rapido que qualquer plosiva.
const ATTACK_MS = 12;

// Release: quao rapido o gate FECHA depois que a fala para. Dividido em duas
// partes de proposito:
//  - HOLD: tempo que o nivel precisa ficar abaixo do limiar de fechamento
//    ANTES de comecar a fechar. Cobre pausas naturais entre palavras/frases
//    sem cortar o fim delas.
//  - RAMP: depois do hold, o proprio fechamento e gradual (rampa de ganho),
//    nunca um corte seco — corte seco produz clique audivel.
const RELEASE_HOLD_MS = 400;
const RELEASE_RAMP_MS = 220;

// Intervalo do loop de medicao/decisao do gate. Nao precisa ser por-frame de
// video (rAF) — e audio, e o attack/release ja tem suas proprias constantes
// de tempo continuas via Web Audio (`setTargetAtTime`/ramps). 30ms (~33Hz) e
// fino o bastante pra nao perder o inicio de uma silaba e barato o bastante
// pra rodar o tempo todo, independente do painel estar aberto ou fechado —
// ISSO aqui precisa continuar rodando sempre (é o gate em si funcionando).
// O que para quando o painel fecha e so o REDESENHO do medidor visual (ver
// SettingsPanel.tsx), nao essa analise.
const TICK_MS = 30;

/** Converte o valor do slider (0-100) pro limiar de FECHAMENTO em dBFS. */
export function thresholdToDb(value: number): number {
  const t = Math.min(GATE_MAX, Math.max(GATE_MIN, value)) / GATE_MAX;
  return THRESHOLD_MIN_DB + t * (THRESHOLD_MAX_DB - THRESHOLD_MIN_DB);
}

/** Converte um nivel em dBFS pra fracao 0..1 da faixa do medidor (pro
 * desenho da barra) — mesma faixa do slider, com uma margem embaixo pra dar
 * espaco visual ao "chao" do medidor mesmo em silencio total. */
const METER_FLOOR_DB = -65;
const METER_CEIL_DB = -5;
export function dbToMeterFraction(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const t = (db - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB);
  return Math.min(1, Math.max(0, t));
}

export function loadGateThresholdPref(): number {
  if (typeof window === 'undefined') return DEFAULT_GATE_THRESHOLD;
  try {
    const raw = window.localStorage.getItem(MIC_GATE_STORAGE_KEY);
    if (raw === null) return DEFAULT_GATE_THRESHOLD;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= GATE_MIN && n <= GATE_MAX) return n;
  } catch {
    // localStorage pode falhar (modo privado, quota etc) — cai no default.
  }
  return DEFAULT_GATE_THRESHOLD;
}

export function saveGateThresholdPref(value: number) {
  try {
    window.localStorage.setItem(MIC_GATE_STORAGE_KEY, String(value));
  } catch {
    // Persistencia e bonus, nao pode quebrar a UI.
  }
}

// --- Ganho de entrada (pre-amplificador) ------------------------------------
//
// Nao confundir com o `gainNode` do GATE, mais abaixo: aquele so alterna entre
// 0 e 1 pra cortar silencio, e usar ele pra ganho quebraria o gate (o ramp de
// abertura vai SEMPRE pra 1). Sao dois GainNode com papeis diferentes.

export const INPUT_GAIN_STORAGE_KEY = 'concord-mic-input-gain';
/** Ganho linear. 1 = sem alteracao. 0.5 = metade, 3 = triplo (~+9.5 dB). */
export const INPUT_GAIN_MIN = 0.5;
export const INPUT_GAIN_MAX = 3;
export const DEFAULT_INPUT_GAIN = 1;

export function loadInputGainPref(): number {
  if (typeof window === 'undefined') return DEFAULT_INPUT_GAIN;
  try {
    const raw = window.localStorage.getItem(INPUT_GAIN_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_INPUT_GAIN;
    return Math.min(INPUT_GAIN_MAX, Math.max(INPUT_GAIN_MIN, parsed));
  } catch {
    return DEFAULT_INPUT_GAIN;
  }
}

function clampInputGain(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_INPUT_GAIN;
  return Math.min(INPUT_GAIN_MAX, Math.max(INPUT_GAIN_MIN, value));
}

export function saveInputGainPref(value: number) {
  try {
    window.localStorage.setItem(INPUT_GAIN_STORAGE_KEY, String(value));
  } catch {
    // Persistencia e bonus, nao pode quebrar a UI.
  }
}

/** Marca (numa chave separada) que essa preferencia ja foi definida por uma
 * escolha explicita da pessoa nesse navegador — usado so pra decidir se
 * vale a pena forcar o gate desligado automaticamente no caso do device
 * "Monitor of ..." (ver MicProcessorBinder.tsx): so forcamos na PRIMEIRA vez,
 * nunca por cima de uma escolha que a pessoa ja fez antes. */
const GATE_TOUCHED_KEY = 'concord-mic-gate-touched';
export function hasGateThresholdBeenSetExplicitly(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(GATE_TOUCHED_KEY) === '1';
  } catch {
    return false;
  }
}
export function markGateThresholdTouched() {
  try {
    window.localStorage.setItem(GATE_TOUCHED_KEY, '1');
  } catch {
    // idem, bonus.
  }
}

export interface MicGateLiveState {
  /** Nivel instantaneo mais recente, em dBFS (tipicamente -100..0). */
  levelDb: number;
  /** Se o gate esta aberto (deixando passar) agora. */
  open: boolean;
}

/** Por que a camada neural nao esta ativa, quando nao esta. */
export type DenoiseStatus =
  | 'active'
  | 'off'
  | 'loading'
  /** Navegador sem AudioWorklet. */
  | 'unsupported'
  /** AudioContext do LiveKit nao esta a 48kHz (ver lib/denoise.ts). */
  | 'wrong-sample-rate'
  /** WASM ou worklet falharam ao carregar/instanciar. */
  | 'failed';

/**
 * `TrackProcessor` de audio que implementa denoise + gate. Cadeia de nós Web
 * Audio:
 *
 *   source (MediaStreamSource da track crua)
 *     -> denoise (RNNoise/GTCRN, opcional — pode ser trocado em runtime)
 *     -> inputGain (pre-amplificador ajustavel; ANTES do analyser pra o
 *        medidor e o gate julgarem o sinal que sai de verdade)
 *     -> analyser (só mede, não altera o sinal)
 *     -> gain (o gate propriamente dito: ataca rápido, solta devagar)
 *     -> destination (MediaStreamDestination — o `.stream` dela vira
 *        `processedTrack`, que o LiveKit publica no lugar da track crua)
 *
 * `threshold` (0-100, mesma escala do slider) e o modelo de denoise podem ser
 * trocados em runtime, via `setThreshold`/`setDenoise`, sem reconstruir a
 * cadeia inteira — `destNode` em particular NUNCA e recriado, porque trocar
 * ele trocaria a `processedTrack` e forçaria republicação da faixa.
 */
export class MicProcessorChain implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = 'concord-mic-processor';
  processedTrack?: MediaStreamTrack;

  private threshold: number;
  private audioContext?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  /** Pre-amplificador ajustavel pela pessoa. Fica ANTES do analyser de
   * proposito: assim o medidor e o gate julgam o sinal que os outros vao de
   * fato ouvir, e nao o sinal cru. */
  private inputGainNode?: GainNode;
  private inputGain: number;
  /** O gate. So alterna 0<->1 — ver nota em INPUT_GAIN_STORAGE_KEY. */
  private gainNode?: GainNode;
  private destNode?: MediaStreamAudioDestinationNode;

  private denoiseModel: DenoiseModel;
  private denoise?: DenoiseNode;
  private denoiseStatus: DenoiseStatus = 'off';
  // Contador de geracao pra resolver corrida: `setDenoise` e assincrono (carrega
  // WASM), e a pessoa pode trocar o seletor tres vezes em um segundo. Quando uma
  // carga termina e a geracao mudou, o nó recem-criado e descartado em vez de
  // entrar na cadeia.
  private denoiseGeneration = 0;
  // `Float32Array<ArrayBuffer>` explicito, nao so `Float32Array`: a partir do
  // TS 5.7 o tipo virou generico sobre o buffer e o default e
  // `ArrayBufferLike`, que inclui `SharedArrayBuffer`. O
  // `getFloatTimeDomainData` aceita apenas `ArrayBuffer`, entao sem o
  // parametro explicito o compilador recusa.
  private timeDomainBuf?: Float32Array<ArrayBuffer>;
  private tickHandle?: ReturnType<typeof setInterval>;

  private gateOpen = true;
  private silenceStartedAt: number | null = null;
  private closing = false;

  /** Callback opcional, chamado a cada tick com o estado atual — é assim que
   * a UI (SettingsPanel) le o nivel ao vivo sem precisar de um segundo
   * AnalyserNode/loop proprio. Setar/limpar é barato, então a UI só o define
   * enquanto o popover está aberto. */
  onLevel?: (state: MicGateLiveState) => void;

  /** Chamado sempre que o status da camada neural muda — é como a UI mostra
   * "carregando", "indisponível neste navegador" ou o fallback silencioso
   * depois de uma falha, sem ficar consultando. */
  onDenoiseStatus?: (status: DenoiseStatus) => void;

  constructor(
    initialThreshold: number,
    initialDenoise: DenoiseModel,
    initialInputGain: number = DEFAULT_INPUT_GAIN,
  ) {
    this.threshold = initialThreshold;
    this.denoiseModel = initialDenoise;
    this.inputGain = clampInputGain(initialInputGain);
  }

  setThreshold(value: number) {
    this.threshold = Math.min(GATE_MAX, Math.max(GATE_MIN, value));
  }

  /** Ganho de entrada, em runtime. Rampa curta em vez de salto seco pra nao
   * dar estalo no meio da fala. */
  setInputGain(value: number) {
    this.inputGain = clampInputGain(value);
    if (this.inputGainNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      this.inputGainNode.gain.cancelScheduledValues(now);
      this.inputGainNode.gain.setValueAtTime(this.inputGainNode.gain.value, now);
      this.inputGainNode.gain.linearRampToValueAtTime(this.inputGain, now + 0.03);
    }
  }

  getDenoiseStatus(): DenoiseStatus {
    return this.denoiseStatus;
  }

  private setDenoiseStatus(status: DenoiseStatus) {
    if (this.denoiseStatus === status) return;
    this.denoiseStatus = status;
    this.onDenoiseStatus?.(status);
  }

  /**
   * Troca (ou remove) o modelo de reducao de ruido em runtime. Reconecta
   * apenas o trecho `source -> ? -> analyser`; o resto da cadeia fica de pé,
   * então não há corte de áudio nem republicação da track.
   *
   * Falha aqui NUNCA propaga: se o WASM não carregar, a cadeia volta a ligar
   * `source` direto no `analyser` e a pessoa continua sendo ouvida, só sem a
   * camada neural.
   */
  async setDenoise(model: DenoiseModel): Promise<void> {
    this.denoiseModel = model;
    const generation = ++this.denoiseGeneration;

    // Sem cadeia montada ainda (setDenoise antes do init): guarda a escolha,
    // o init aplica.
    if (!this.audioContext || !this.sourceNode || !this.analyser || !this.inputGainNode) {
      return;
    }

    this.detachDenoise();

    if (model === 'off') {
      this.sourceNode.connect(this.inputGainNode);
      this.setDenoiseStatus('off');
      return;
    }
    if (!isAudioWorkletSupported()) {
      this.sourceNode.connect(this.inputGainNode);
      this.setDenoiseStatus('unsupported');
      return;
    }
    if (!isSampleRateSupported(this.audioContext)) {
      this.sourceNode.connect(this.inputGainNode);
      this.setDenoiseStatus('wrong-sample-rate');
      return;
    }

    // Enquanto o WASM carrega (primeira ativação; depois vem do cache), o áudio
    // segue passando cru em vez de ficar mudo esperando.
    this.sourceNode.connect(this.inputGainNode);
    this.setDenoiseStatus('loading');

    let created: DenoiseNode;
    try {
      created = await createDenoiseNode(this.audioContext, model);
    } catch {
      if (generation === this.denoiseGeneration) {
        this.setDenoiseStatus('failed');
      }
      return;
    }

    // A pessoa trocou de modelo (ou o processor morreu) enquanto carregava —
    // joga fora o nó recém-criado em vez de plugar um modelo que já não é o
    // escolhido.
    if (
      generation !== this.denoiseGeneration ||
      !this.sourceNode ||
      !this.analyser ||
      !this.inputGainNode
    ) {
      created.destroy();
      return;
    }

    this.sourceNode.disconnect(this.inputGainNode);
    this.sourceNode.connect(created.node);
    created.node.connect(this.inputGainNode);
    this.denoise = created;
    this.setDenoiseStatus('active');
  }

  /** Tira o nó de denoise da cadeia e libera a instância WASM do worklet.
   * Deixa `source` desconectado — quem chama religa como precisar. */
  private detachDenoise() {
    this.sourceNode?.disconnect();
    if (this.denoise) {
      try {
        this.denoise.node.disconnect();
      } catch {
        // Já desconectado — limpeza redundante, não é erro.
      }
      this.denoise.destroy();
      this.denoise = undefined;
    }
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const ctx = opts.audioContext;
    this.audioContext = ctx;
    const stream = new MediaStream([opts.track]);
    this.sourceNode = ctx.createMediaStreamSource(stream);

    this.analyser = ctx.createAnalyser();
    // fftSize pequeno: só queremos um RMS de curto prazo pra decisão do
    // gate, não uma FFT de verdade. 512 amostras a 48kHz é ~10ms de janela —
    // fino o bastante pra não atrasar o attack.
    this.analyser.fftSize = 512;
    this.timeDomainBuf = new Float32Array(this.analyser.fftSize);

    this.inputGainNode = ctx.createGain();
    this.inputGainNode.gain.value = this.inputGain;
    this.inputGainNode.connect(this.analyser);

    this.gainNode = ctx.createGain();
    // Começa aberto (ganho 1) — evita silêncio de 1 frame no instante da
    // publicação antes do primeiro tick do loop rodar.
    this.gainNode.gain.value = 1;

    this.destNode = ctx.createMediaStreamDestination();

    this.analyser.connect(this.gainNode);
    this.gainNode.connect(this.destNode);

    this.processedTrack = this.destNode.stream.getAudioTracks()[0];

    this.tickHandle = setInterval(() => this.tick(), TICK_MS);

    // Fecha a cadeia ligando `source` no `analyser` — com ou sem denoise no
    // meio, conforme o modelo escolhido. Deliberadamente sem `await`: o publish
    // da track não pode ficar esperando o download do WASM, e enquanto ele não
    // chega o áudio já passa cru (ver setDenoise).
    void this.setDenoise(this.denoiseModel);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    // Troca de device (ex: pessoa mudou o microfone no dropdown) — refaz a
    // cadeia do zero em vez de tentar remendar os nós existentes.
    await this.destroy();
    await this.init(opts);
  }

  private tick() {
    if (!this.analyser || !this.timeDomainBuf || !this.gainNode || !this.audioContext) return;

    this.analyser.getFloatTimeDomainData(this.timeDomainBuf);
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomainBuf.length; i++) {
      const v = this.timeDomainBuf[i];
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / this.timeDomainBuf.length);
    const levelDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    // Threshold 0 = gate desligado: sempre aberto, sem tocar no ganho (além
    // de mais barato, evita qualquer rampa residual ficar presa fechada se
    // a pessoa zerar o slider bem no meio de uma fala).
    if (this.threshold <= GATE_MIN) {
      if (!this.gateOpen) {
        this.openGateNow();
      }
      this.onLevel?.({ levelDb, open: true });
      return;
    }

    const closeThresholdDb = thresholdToDb(this.threshold);
    const openThresholdDb = closeThresholdDb + HYSTERESIS_DB;
    const now = this.audioContext.currentTime;

    if (levelDb >= openThresholdDb) {
      // Acima do limiar de abertura: abre (ou mantém aberto) IMEDIATAMENTE.
      this.silenceStartedAt = null;
      this.closing = false;
      if (!this.gateOpen) {
        this.gateOpen = true;
        // Rampa curta em vez de salto — mesmo o "attack rápido" precisa ser
        // uma rampa, não um degrau, pra não estalar.
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(1, now + ATTACK_MS / 1000);
      }
    } else if (levelDb < closeThresholdDb) {
      // Abaixo do limiar de fechamento: só começa a fechar depois de
      // RELEASE_HOLD_MS de silêncio contínuo — é isso que segura pausas
      // curtas entre palavras sem fechar no meio delas.
      if (this.silenceStartedAt === null) {
        this.silenceStartedAt = performance.now();
      } else if (!this.closing && performance.now() - this.silenceStartedAt >= RELEASE_HOLD_MS) {
        this.closing = true;
        this.gateOpen = false;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + RELEASE_RAMP_MS / 1000);
      }
    } else {
      // Entre os dois limiares (zona de histerese): não mexe em nada, nem
      // reinicia a contagem de silêncio nem cancela um fechamento em curso.
    }

    this.onLevel?.({ levelDb, open: this.gateOpen });
  }

  private openGateNow() {
    if (!this.gainNode || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    this.gateOpen = true;
    this.closing = false;
    this.silenceStartedAt = null;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(1, now + ATTACK_MS / 1000);
  }

  async onPublish(_room: Room): Promise<void> {
    // Nada a fazer — o processedTrack já foi trocado no sender por
    // `setProcessor` antes deste hook rodar.
  }

  async onUnpublish(): Promise<void> {
    // idem — sem estado externo a limpar aqui.
  }

  async destroy(): Promise<void> {
    if (this.tickHandle !== undefined) {
      clearInterval(this.tickHandle);
      this.tickHandle = undefined;
    }
    // Invalida qualquer carga de denoise em voo: se o WASM chegar depois daqui,
    // o nó criado é descartado em vez de ser plugado numa cadeia morta.
    this.denoiseGeneration++;
    this.detachDenoise();
    this.denoiseStatus = 'off';
    try {
      this.sourceNode?.disconnect();
      this.analyser?.disconnect();
      this.inputGainNode?.disconnect();
      this.gainNode?.disconnect();
    } catch {
      // Nós já podem ter sido desconectados/descartados — não é um erro
      // real, só limpeza redundante.
    }
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.sourceNode = undefined;
    this.analyser = undefined;
    this.inputGainNode = undefined;
    this.gainNode = undefined;
    this.destNode = undefined;
  }
}
