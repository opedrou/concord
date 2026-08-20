'use client';

// Efeitos sonoros curtos da interface (entrar, sair, transmissao abrindo e
// fechando; a soundboard usa o mesmo caminho).
//
// POR QUE UM AUDIOCONTEXT PROPRIO, SEPARADO DO DA CALL
// ----------------------------------------------------
// O `Room` recebe um `webAudioMix.audioContext` proprio (ver
// PageClientImpl.tsx e createAudioContextForDenoise em lib/denoise.ts) — e ele
// e o contexto por onde passam as VOZES, com o volume por participante e o
// volume geral aplicados em cima. Bipe de entrada nao pode andar junto com
// isso: abaixar o volume da call nao deveria abaixar o som de "fulano entrou",
// e vice-versa. Sao dois barramentos com donos diferentes, entao sao dois
// contextos.
//
// POR QUE AudioBuffer E NAO <audio src=...>
// -----------------------------------------
// Um `<audio>` por som significa elemento no DOM, latencia de primeira
// reproducao e nenhum controle de ganho sem Web Audio de qualquer jeito. Com
// `decodeAudioData` o arquivo e baixado e decodificado UMA vez, fica em
// memoria como `AudioBuffer` e cada toque e um `AudioBufferSourceNode`
// descartavel — que e exatamente o caso de uso (sons curtos, repetidos, que
// podem se sobrepor).
//
// REGRA DE OURO DESTE ARQUIVO: som nunca quebra a call. Toda falha aqui
// (rede, decode, autoplay bloqueado, navegador sem Web Audio) e engolida em
// silencio — no pior caso a pessoa fica sem o efeito sonoro.

let sfxContext: AudioContext | null = null;

/** `null` se o navegador nao tem Web Audio ou se a criacao falhou. */
function getSfxContext(): AudioContext | null {
  if (sfxContext) {
    return sfxContext;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    sfxContext = new Ctor();
    return sfxContext;
  } catch {
    return null;
  }
}

// Fontes tocando agora. Um `AudioBufferSourceNode` nao da pra consultar
// ("esta tocando?"), entao guardamos as vivas aqui e o `onended` (que dispara
// tanto no fim natural quanto no `stop()`) faz a limpeza. E isso que permite
// o botao de PARAR da soundboard.
const playing = new Set<AudioBufferSourceNode>();

// Cache por URL. Guarda a PROMESSA, nao o buffer pronto: dois toques quase
// simultaneos do mesmo som (ou o preload e um toque se cruzando) reaproveitam
// o mesmo download em vez de disparar dois.
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) {
    return cached;
  }
  const ctx = getSfxContext();
  if (!ctx) {
    return Promise.resolve(null);
  }
  const promise = fetch(url)
    .then((res) => {
      if (!res.ok) {
        throw new Error(`${url}: ${res.status}`);
      }
      return res.arrayBuffer();
    })
    // `decodeAudioData` funciona mesmo com o contexto suspenso — o que a
    // politica de autoplay bloqueia e o `start()`, tratado em `playSfx`.
    .then((data) => ctx.decodeAudioData(data))
    .catch(() => {
      // Remove do cache pra uma proxima tentativa poder dar certo (ex: falha
      // de rede momentanea no primeiro toque).
      buffers.delete(url);
      return null;
    });
  buffers.set(url, promise);
  return promise;
}

/**
 * O `AudioBuffer` decodificado, ou `null` se falhou. Exposto pro editor de
 * corte, que precisa das amostras pra desenhar a forma de onda e da duracao
 * pra posicionar as alcas.
 */
export function loadSoundBuffer(url: string): Promise<AudioBuffer | null> {
  return loadBuffer(url);
}

/**
 * Baixa e decodifica antecipadamente. Sem isso o PRIMEIRO toque de cada som
 * chegaria atrasado pelo tempo de rede — justamente o toque que mais importa
 * (alguem entrou na sala).
 */
export function preloadSfx(urls: readonly string[]): void {
  for (const url of urls) {
    void loadBuffer(url);
  }
}

export interface PlaySfxOptions {
  /** Ganho linear (1 = volume original do arquivo). */
  gain?: number;
  /** Segundos a pular no comeco do arquivo (corte de entrada). */
  start?: number;
  /** Segundo em que o som para (corte de saida). `undefined` = ate o fim. */
  end?: number;
}

/**
 * Toca um som. Nao devolve nada e nunca rejeita: quem chama nao tem o que
 * fazer com a falha.
 */
export function playSfx(url: string, options: PlaySfxOptions = {}): void {
  const ctx = getSfxContext();
  if (!ctx) {
    return;
  }
  void loadBuffer(url).then((buffer) => {
    if (!buffer) {
      return;
    }
    const fire = () => {
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gainNode = ctx.createGain();
        gainNode.gain.value = options.gain ?? 1;
        source.connect(gainNode).connect(ctx.destination);

        // Corte nao destrutivo: o arquivo no disco continua inteiro, o
        // `start(when, offset, duration)` da Web Audio pula o comeco e para
        // no fim escolhido. Zero reencode, zero ffmpeg no servidor.
        const offset = clampToBuffer(options.start ?? 0, buffer.duration);
        const end = clampToBuffer(options.end ?? buffer.duration, buffer.duration);
        const duration = end - offset;
        if (duration <= 0) {
          return;
        }
        playing.add(source);
        source.onended = () => {
          playing.delete(source);
          source.disconnect();
          gainNode.disconnect();
        };
        source.start(0, offset, duration);
      } catch {
        // Contexto fechado no meio do caminho, por exemplo.
      }
    };
    if (ctx.state === 'suspended') {
      // Politica de autoplay: o contexto so toca depois de um gesto do
      // usuario. Clicar pra entrar no canal ja conta, mas se o resume falhar
      // (aba em segundo plano, navegador teimoso) so ficamos sem o som.
      ctx
        .resume()
        .then(fire)
        .catch(() => {});
    } else {
      fire();
    }
  });
}

function clampToBuffer(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) {
    return duration;
  }
  return Math.min(Math.max(seconds, 0), duration);
}

/**
 * Corta tudo que estiver tocando agora. Vale pros bipes da interface tambem —
 * na pratica so a soundboard toca algo longo o bastante pra alguem querer
 * parar.
 */
export function stopAllSfx(): void {
  for (const source of playing) {
    try {
      source.stop();
    } catch {
      // Ja terminou; o `onended` limpa.
    }
  }
  playing.clear();
}

/** Fecha o contexto compartilhado. So faz sentido ao sair da call. */
export function closeSfxContext(): void {
  const ctx = sfxContext;
  sfxContext = null;
  playing.clear();
  // Os buffers foram decodificados PARA esse contexto — num contexto novo eles
  // nao servem, entao o cache vai junto.
  buffers.clear();
  ctx?.close().catch(() => {});
}
