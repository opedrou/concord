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
 * Baixa e decodifica antecipadamente. Sem isso o PRIMEIRO toque de cada som
 * chegaria atrasado pelo tempo de rede — justamente o toque que mais importa
 * (alguem entrou na sala).
 */
export function preloadSfx(urls: readonly string[]): void {
  for (const url of urls) {
    void loadBuffer(url);
  }
}

/**
 * Toca um som. `gain` e ganho linear (1 = volume original do arquivo).
 * Nao devolve nada e nunca rejeita: quem chama nao tem o que fazer com a
 * falha.
 */
export function playSfx(url: string, options: { gain?: number } = {}): void {
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
        source.start();
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

/** Fecha o contexto compartilhado. So faz sentido ao sair da call. */
export function closeSfxContext(): void {
  const ctx = sfxContext;
  sfxContext = null;
  // Os buffers foram decodificados PARA esse contexto — num contexto novo eles
  // nao servem, entao o cache vai junto.
  buffers.clear();
  ctx?.close().catch(() => {});
}
