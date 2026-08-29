'use client';

import * as React from 'react';
import type { LocalAudioTrack, Participant, RemoteAudioTrack } from 'livekit-client';
import { isTrackReference, useIsSpeaking, useTrackVolume } from '@livekit/components-react';
import type { TrackReference } from '@livekit/components-react';

// ---------------------------------------------------------------------------
// Por que esse hook existe
// ---------------------------------------------------------------------------
//
// O `useIsSpeaking` (de @livekit/components-react) deriva do
// `RoomEvent.ActiveSpeakersChanged`, calculado no SERVIDOR (livekit-server na
// VPS Oracle — ver HANDOFF §1) e transmitido de volta pro cliente. O caminho
// e: mic -> upload pro SFU -> servidor mede nivel, suaviza, decide quem esta
// "active speaker" -> broadcast -> React atualiza. Isso e uma volta de rede
// inteira mais o intervalo de agregacao do servidor (ver `livekit.yaml` —
// nota no fim do arquivo). Por esse caminho a luz de "falando" nunca acende
// instantaneo, e foi essa a reclamacao original.
//
// `useTrackVolume` mede o nivel da track direto no navegador via Web Audio
// API (AnalyserNode local), sem depender de nada do servidor — o audio da
// pessoa ja chegou na maquina antes de qualquer evento do LiveKit sobre ele.
// Esse hook usa isso como fonte primaria e cai pro `useIsSpeaking` (via
// RoomEvent do servidor) só quando o caminho local nao da pra confiar.
//
// ATENCAO — ISOLAMENTO DE API INSTAVEL: `useTrackVolume` e `isTrackReference`
// vem marcados `@alpha` / sao API interna do @livekit/components-react — ver
// node_modules/@livekit/components-react/dist/hooks/useTrackVolume.d.ts. Nao
// ha garantia de estabilidade entre versoes minor. Esse arquivo E a camada de
// isolamento: se a lib mudar a assinatura ou o comportamento num upgrade, o
// erro fica contido aqui, não espalhado pelos componentes que consomem
// `useSpeakingIndicator`.

/** Track de audio que pode ser analisada localmente: tanto a track "crua" do
 * livekit-client quanto a `TrackReference` que o @livekit/components-react
 * usa internamente (o que os tiles de participante costumam ter à mão via
 * `useTracks`). */
export type SpeakingIndicatorTrack = LocalAudioTrack | RemoteAudioTrack | TrackReference;

export interface UseSpeakingIndicatorOptions {
  /** Nivel (0..1, RMS aproximado que o useTrackVolume calcula) acima do qual
   * consideramos que a pessoa COMECOU a falar. Mais alto que o de descida de
   * proposito — histerese classica. Em tracks remotas isso e so um detector
   * de "tem sinal", nao um detector de "e fala": o noise gate por pessoa
   * (micProcessor.ts) ja decidiu isso na origem antes de publicar — ver o
   * bloco de calibracao no topo do arquivo. */
  riseThreshold?: number;
  /** Nivel abaixo do qual, mantido por `holdMs`, consideramos que a pessoa
   * PAROU de falar. Mais baixo que `riseThreshold`. */
  fallThreshold?: number;
  /** Quanto tempo (ms) o nivel precisa ficar abaixo de `fallThreshold` antes
   * de apagar o indicador. Isso e o que impede o piscar tipo estroboscopio
   * durante fala normal (pausas entre palavras, plosivas etc). Instantaneo
   * sem hold e pior que ficar levemente atrasado e estavel. */
  holdMs?: number;
  /** Quanto tempo (ms) o servidor pode dizer "esta falando" sem que o nosso
   * nivel local nunca tenha cruzado `riseThreshold`, antes de desistirmos do
   * caminho local (analyser quebrado/travado por algum motivo silencioso —
   * ver "watchdog" no corpo do hook) e usarmos o sinal do servidor. O
   * watchdog pode disparar de novo depois disso — ver "nova chance" no
   * corpo do hook — nao e mais definitivo pro resto do mount. */
  watchdogMs?: number;
  /** Piso (dBFS) da janela que o AnalyserNode mapeia linearmente pra
   * 0..255 via `getByteFrequencyData` — ver o bloco de calibração no topo
   * do arquivo pra entender por que isso existe. Anda junto com
   * `maxDecibels`: mudar só este aqui descalibra o outro (`riseThreshold`/
   * `fallThreshold` sao baixos o bastante hoje que nao precisam recalcular
   * junto — ver bloco de calibração). Overridável só pra dar pra varrer
   * valores durante uma verificação sem recompilar — não é pra UI normal
   * mexer. */
  minDecibels?: number;
  /** Teto (dBFS) da janela — ver `minDecibels`. */
  maxDecibels?: number;
}

export interface SpeakingIndicatorResult {
  /** Indicador final, já com histerese/hold aplicados — é isso que a UI deve
   * usar pra acender/apagar o anel de "falando". */
  isSpeaking: boolean;
  /** Nivel bruto mais recente (0..1) quando a fonte ativa e o volume local;
   * `null` quando estamos no fallback via servidor (não há nível contínuo
   * nesse caminho, só o booleano). Útil pra um medidor de VU, se um dia
   * quiser um, mas opcional — a maioria dos tiles só quer `isSpeaking`. */
  level: number | null;
  /** De onde `isSpeaking` está vindo agora. Só pra debug/telemetria — não
   * deveria ser necessário pra UI normal. */
  source: 'local-volume' | 'server-events';
}

// ---------------------------------------------------------------------------
// Bloco de calibração — o que esses quatro valores precisam fazer mudou
// ---------------------------------------------------------------------------
//
// `minDecibels`/`maxDecibels` definem a janela de decibéis que o
// AnalyserNode mapeia LINEARMENTE pra byte 0..255 (`getByteFrequencyData`,
// dentro do `useTrackVolume` da lib — o `calculateVolume` do livekit-client
// faz RMS em cima desses bytes, então o nível 0..1 que o hook expõe já é
// essa janela comprimida). O `useTrackVolume`/`createAudioAnalyser` da lib
// NÃO tem defaults pensados pra fala: sem esses dois campos explícitos,
// valem os defaults do `createAudioAnalyser` (livekit-client) —
// -100/-80 dBFS, uma janela de só 20 dB. Qualquer coisa acima de -80 dBFS já
// satura em 255, então o nível 0..1 cola perto de 0 ou perto de 1 e quase
// não varia no meio — o oposto do que o JSDoc de `SpeakingIndicatorResult`
// promete ("RMS aproximado"). Essa é a causa raiz do "não aparece"/"não sai
// do lugar" documentada no plano (PLANO-2.md, item R2). -70/-25 (mantido)
// foi escolhido olhando a faixa de referência que o gate de mic já usa neste
// projeto (`METER_FLOOR_DB = -65` / `METER_CEIL_DB = -5` em
// micProcessor.ts:117-118, a melhor âncora empírica disponível aqui).
//
// `riseThreshold`/`fallThreshold`: o plano original de calibrar esses dois
// contra fala real numa call foi CANCELADO — não porque virou desnecessário
// calibrar, mas porque a pergunta que eles respondem mudou. Este hook mede
// tracks REMOTAS (o tile local já não usa mais threshold nenhum — segue o
// `gateOpen` do próprio gate, ver `CallParticipantTile.tsx`). E toda track
// remota, antes de chegar aqui, já passou pelo noise gate por pessoa de
// `micProcessor.ts`: denoise neural → AnalyserNode → GainNode (o gate) →
// publicação no SFU (`LocalAudioTrack.setProcessor`). O gate está LIGADO por
// padrão pra todo mundo (`DEFAULT_GATE_THRESHOLD = 12`, `GATE_MIN = 0` —
// só desliga quem arrasta o slider até 0) e, quando fecha, faz
// `gainNode.gain.linearRampToValueAtTime(0, ...)`: o que chega no navegador
// de quem está ouvindo NÃO é "som baixo", é silêncio de verdade.
//
// Ou seja: a pessoa remota já escolheu, na origem, o que conta como "sinal"
// — é o threshold do gate DELA. Este hook não precisa mais decidir "isso é
// fala ou ruído de fundo?" (o gate já decidiu isso antes de publicar); ele
// só precisa decidir "está passando áudio, ou está em zero?". Essa é uma
// pergunta muito mais fácil, e é por isso que não faz mais sentido gastar
// uma calibração fina em cima dela.
//
// Os dois valores abaixo refletem isso: BAIXOS de propósito, porque
// qualquer coisa "alta" cortaria fala baixa que o gate já deixou passar
// intencionalmente (a pessoa que fala baixo e configurou o gate pra deixar
// passar não pode ter o indicador apagado por um threshold nosso mais
// rigoroso que o dela). Um threshold baixo não reintroduz o problema de
// ruído de fundo que motivava um valor mais alto na leitura antiga do
// hook: o que sobra pra medir aqui já passou por denoise neural E pelo
// gate na origem — se não há fala, o nível que chega é ~0, não "ruído
// baixo mas presente".
//
// São ESTIMATIVAS DE ENGENHARIA, não medições — nunca passaram por uma call
// de verdade medindo especificamente este hook. O modo de calibração
// (`loadCalibrationModeEnabled` abaixo) continua no arquivo, mas mudou de
// papel: deixou de ser pré-requisito pra mexer nesses números e virou
// ferramenta de VERIFICAÇÃO — usar pra confirmar que o nível cai perto de
// zero quando o gate de alguém fecha e sobe claramente acima do threshold
// quando ela fala, não pra descobrir o valor do zero.
const DEFAULT_MIN_DECIBELS = -70;
const DEFAULT_MAX_DECIBELS = -25;
// 0.02: só precisa ficar acima do que um gate fechado (nível ~0, rampa de
// RELEASE_RAMP_MS=220ms em micProcessor.ts) deixa passar durante a rampa de
// descida, sem cortar fala baixa que o gate de origem já deixou passar.
const DEFAULT_RISE_THRESHOLD = 0.02;
// 0.01: mais baixo que riseThreshold só pela histerese clássica (subida >
// descida evita ida-e-volta no limiar); não precisa de mais distância que
// isso porque a fonte já não tem ruído de fundo pra confundir a descida.
const DEFAULT_FALL_THRESHOLD = 0.01;
// Era 300ms. Investigando o "lag" relatado (ver notas no relatorio): o CSS
// do proprio LiveKit (@livekit/components-styles,
// .lk-participant-tile::after) ja aplica `transition-delay: .5s` +
// `transition-duration: .4s` quando `data-lk-speaking` volta pra `false` —
// so a borda ACENDER e que e rapida (`.2s` sem delay, regra especifica de
// `[data-lk-speaking=true]`); APAGAR ja e deliberadamente lento la, pra nao
// piscar. Com holdMs em 300ms, o atraso total percebido ao PARAR de falar
// virava holdMs + 0.5s + 0.4s ≈ 1.2s — dois mecanismos de anti-flicker
// empilhados (um nosso em JS, outro do CSS), quando um so ja bastava. Cortado
// pela metade: ainda segura pausas curtas entre palavras, sem somar tanto em
// cima do que o CSS ja da de graca.
const DEFAULT_HOLD_MS = 150;
// Era 1500ms. Nao ha motivo forte pra manter tao alto — 1s ja e tempo
// suficiente pro servidor confirmar "esta falando" antes de desistirmos do
// caminho local (ver logica do watchdog abaixo), e desiste mais cedo de um
// analyser que nao esta funcionando.
const DEFAULT_WATCHDOG_MS = 1000;
// Quantas vezes o watchdog aceita dar nova chance ao caminho local numa
// fronteira limpa (servidor: parou -> voltou a falar) antes de desistir de
// vez pro resto do mount — ver comentário completo junto ao watchdog. Fixo
// (não é opção do hook): não há indício de que precise variar por chamador.
const WATCHDOG_MAX_RETRIES = 3;

// fftSize baixo de proposito: e o mesmo default que o useTrackVolume ja usa
// (32 — ver hooks-C7fu1g_i.mjs dentro do pacote), só estamos sendo explicitos
// pra não depender de um default que a lib pode mudar num upgrade "alpha".
// Com 5 participantes numa call isso da 5 AnalyserNode de 32 bins cada, e
// cada um roda um setInterval a ~30fps por dentro do proprio hook da lib —
// custo desprezivel comparado a qualquer coisa de video. smoothingTimeConstant
// um pouco acima do default (0) tira ruido de amostra-a-amostra na origem,
// mas a suavizacao temporal de verdade (o que evita o piscar) e a histerese
// abaixo, nao isso. Esses dois (ao contrário de min/maxDecibels) não fazem
// parte do bloco de calibração e não são overridáveis — não há indício de
// que precisem mudar junto com a janela de dB.
const ANALYSER_FFT_SIZE = 32;
const ANALYSER_SMOOTHING_TIME_CONSTANT = 0.15;

// ---------------------------------------------------------------------------
// Modo de calibração — desligado por padrão, ligado por localStorage
// ---------------------------------------------------------------------------
//
// Mesmo padrão de flag que o resto do projeto já usa (ver
// `loadGateThresholdPref` em micProcessor.ts, `loadNoiseLevelPref` em
// denoise.ts, `loadQualityPref` em screenShareQuality.ts): leitura com
// try/catch, cai no default (desligado) se falhar.
//
// COMO USAR (pra VERIFICAR riseThreshold/fallThreshold contra o gate real —
// não mais pra descobrir o valor deles do zero, ver bloco acima):
//  1. No console do Chrome, ANTES de entrar na call:
//       localStorage.setItem('concord-speaking-calibration', '1')
//     e dê F5 — a flag só é lida uma vez, no mount do hook (mesmo padrão do
//     `audioApiSupported` logo abaixo), não muda em runtime.
//  2. Entre na call com o mic de quem reclamou do indicador. Fale NORMAL
//     por uns 30s (conversa comum, nem grito nem sussurro), depois fique
//     30s em silêncio deixando o GATE fechar de verdade (sem digitar, sem
//     mexer no mic) — é o gate fechado que interessa verificar, não
//     silêncio com gate aberto.
//  3. O console imprime uma linha a cada CALIBRATION_LOG_INTERVAL_MS por
//     participante com fonte local ativa, tipo:
//       [concord-calibração] joao nível min=0.021 max=0.183 média=0.096 (n=58)
//     Separe mentalmente as linhas de quando você estava falando das de
//     quando o gate estava fechado (o timestamp do console já ajuda nisso).
//  4. O que checar: com o gate fechado, o nível deve ficar perto de zero
//     (bem abaixo de `fallThreshold`); falando normal, deve ficar claramente
//     acima de `riseThreshold`. Se as duas faixas se sobrepõem — silêncio
//     com gate fechado produzindo número parecido com fala — o suspeito
//     não são mais os thresholds (já são baixos de propósito), é a janela
//     `minDecibels`/`maxDecibels`, ou o gate daquela pessoa configurado
//     baixo demais (sensibilidade em 0, efetivamente desligado).
//  5. Desligue com `localStorage.removeItem('concord-speaking-calibration')`
//     + F5 quando terminar. Não deixar ligado em uso normal.
//
// Custo: DESLIGADO (o padrão), é um `if` por tick de ~30Hz — nenhum array,
// nenhum console.log. LIGADO, acumula só 4 números (min/max/soma/contagem)
// por participante e imprime UMA linha a cada CALIBRATION_LOG_INTERVAL_MS,
// nunca por tick. Sem percentis de propósito — min/max/média já bastam pra
// escolher threshold, e guardar todas as amostras pra percentil só
// complicaria uma flag de debug.
const CALIBRATION_STORAGE_KEY = 'concord-speaking-calibration';
const CALIBRATION_LOG_INTERVAL_MS = 2000;

function loadCalibrationModeEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(CALIBRATION_STORAGE_KEY) === '1';
  } catch {
    // localStorage pode falhar (modo privado, quota etc) — cai em
    // "desligado", mesmo tratamento das outras prefs do projeto.
    return false;
  }
}

function hasAudioContextSupport(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return Boolean(
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext,
  );
}

/** Extrai a track "crua" de um `SpeakingIndicatorTrack`, se der. `undefined`
 * quando não há nada analisável ainda (ex: TrackReference cujo publication
 * ainda não tem `.track`, ou nenhuma track foi passada). Não lança nunca. */
function resolveRawTrack(
  track: SpeakingIndicatorTrack | undefined,
): LocalAudioTrack | RemoteAudioTrack | undefined {
  if (!track) {
    return undefined;
  }
  if (isTrackReference(track)) {
    const raw = track.publication?.track;
    // A track de uma TrackReference pode ser de audio ou video dependendo de
    // onde veio; como quem chama esse hook já deveria estar passando uma
    // referencia de audio (ver assinatura), só validamos o kind por
    // segurança — se vier torto, tratamos como "sem track" e caimos no
    // fallback em vez de alimentar um analyser com a coisa errada.
    if (raw && raw.kind === 'audio') {
      return raw as LocalAudioTrack | RemoteAudioTrack;
    }
    return undefined;
  }
  return track;
}

/**
 * Indicador de "participante está falando" com latência mínima.
 *
 * Fonte primária: nível de áudio medido localmente via Web Audio API
 * (`useTrackVolume`, direto no navegador — sem ida e volta pro servidor).
 * Aplica histerese (limiar de subida > limiar de descida) + hold time antes
 * de apagar, pra não piscar durante fala normal.
 *
 * Fallback: se não houver track pra analisar, se o navegador não suportar
 * Web Audio, ou se o watchdog perceber que o servidor diz "falando" e o
 * nível local nunca acompanhou (sinal de que o analyser não está
 * funcionando por algum motivo silencioso), o hook usa
 * `useIsSpeaking(participant)` — o caminho via servidor, mais lento porém
 * confiável — em vez de deixar o indicador morto.
 *
 * @param participant Participante dono do mic. Necessário pro fallback via
 *   servidor; sem ele, se o caminho local falhar o indicador simplesmente
 *   nunca acende (documentado aqui de propósito — passe sempre que tiver).
 * @param audioTrack Track de áudio do microfone a analisar — aceita tanto a
 *   track crua (`LocalAudioTrack`/`RemoteAudioTrack`) quanto a
 *   `TrackReference` que os tiles normalmente já têm via `useTracks`. Passe
 *   `undefined` (ex: participante mutado / sem publicação ainda) para usar
 *   só o fallback.
 * @param options Limiares/tempos de histerese, watchdog e a janela de dB do
 *   analyser — ver o "Bloco de calibração" no topo do arquivo. `holdMs`/
 *   `watchdogMs` foram calibrados pra "parecer natural" numa call de voz
 *   normal; `riseThreshold`/`fallThreshold` são estimativas de engenharia
 *   (não medições) apoiadas no noise gate por pessoa que já roda antes da
 *   publicação — ver comentários nos defaults.
 */
export function useSpeakingIndicator(
  participant: Participant | undefined,
  audioTrack: SpeakingIndicatorTrack | undefined,
  options: UseSpeakingIndicatorOptions = {},
): SpeakingIndicatorResult {
  const {
    riseThreshold = DEFAULT_RISE_THRESHOLD,
    fallThreshold = DEFAULT_FALL_THRESHOLD,
    holdMs = DEFAULT_HOLD_MS,
    watchdogMs = DEFAULT_WATCHDOG_MS,
    minDecibels = DEFAULT_MIN_DECIBELS,
    maxDecibels = DEFAULT_MAX_DECIBELS,
  } = options;

  const rawTrack = resolveRawTrack(audioTrack);

  // Suporte a Web Audio é checado uma vez (não muda em runtime); se não
  // houver suporte, nunca passamos uma track de verdade pro useTrackVolume —
  // é o jeito de evitar que o `createAudioAnalyser` interno da lib chegue a
  // lançar (ele lança de forma sincrona dentro do proprio useEffect dela
  // quando `new AudioContext()` não existe, e isso não tem como ser
  // capturado por um try/catch daqui de fora — ver nota no relatório).
  const audioApiSupported = React.useRef(hasAudioContextSupport()).current;
  const trackForVolumeHook = audioApiSupported ? rawTrack : undefined;

  // `useTrackVolume` já cuida da própria limpeza (fecha o AudioContext que
  // ele mesmo cria e limpa o setInterval no cleanup do efeito, toda vez que
  // a track ou as opções mudam, e no unmount) — conferido lendo o bundle:
  // node_modules/@livekit/components-react/dist/hooks-C7fu1g_i.mjs. Não
  // precisamos (nem devemos) gerenciar AnalyserNode manualmente aqui.
  //
  // Esse AudioContext é criado internamente pela lib (`getNewAudioContext`
  // em livekit-client), um novo por chamada — INDEPENDENTE do AudioContext
  // do `webAudioMix: true` das RoomOptions (usado pro boost de volume por
  // participante, ver ParticipantAudioPanel.tsx) e do AudioContext próprio
  // do JoinLeaveSounds.tsx (bipes de entrar/sair). Os três nunca se tocam.
  // `useTrackVolume` compara options por `JSON.stringify` internamente (ver
  // hooks-C7fu1g_i.mjs) pra decidir se recria o AnalyserNode — um objeto
  // novo por render não recria nada à toa, mas ainda assim usamos useMemo
  // pra não montar um objeto novo em todo render sem necessidade.
  const analyserOptions = React.useMemo(
    () => ({
      fftSize: ANALYSER_FFT_SIZE,
      smoothingTimeConstant: ANALYSER_SMOOTHING_TIME_CONSTANT,
      minDecibels,
      maxDecibels,
    }),
    [minDecibels, maxDecibels],
  );
  const rawLevel = useTrackVolume(trackForVolumeHook, analyserOptions);

  // Sinal do servidor — sempre calculado (custo é só um listener de evento),
  // serve tanto de fallback quanto de referência pro watchdog abaixo.
  const serverIsSpeaking = useIsSpeaking(participant);

  const canUseLocalVolume = audioApiSupported && rawTrack !== undefined;

  // --- Watchdog: local nunca acompanhou o servidor -------------------------
  //
  // Se o caminho local está "disponível" (track existe, browser suporta) mas
  // o nível nunca cruza o limiar de subida enquanto o servidor diz "está
  // falando" por tempo suficiente, algo está errado silenciosamente (ex:
  // getByteFrequencyData sempre zerado por alguma peculiaridade do device) —
  // não é algo que dá pra detectar com try/catch, então comparamos com a
  // verdade do servidor.
  //
  // Enquanto o servidor continua dizendo "está falando", o watchdog fica
  // acionado sem exceção — nunca volta a confiar no local NO MEIO de uma
  // fala, que seria a própria definição de "alternar de fonte" e mais
  // confuso que só ficar no fallback.
  //
  // NOVA CHANCE (R3 do plano): fora do meio de uma fala, "acionado pra
  // sempre" tinha um efeito colateral ruim — quem tem mic mais fraco, ganho
  // de entrada baixo ou denoise agressivo caía no caminho lento do servidor
  // PERMANENTEMENTE, só pra aquela pessoa, pelo resto da call, mesmo que o
  // caminho local estivesse são o tempo todo depois daquele primeiro
  // tropeço. A correção: só numa FRONTEIRA limpa relatada pelo servidor —
  // "estava falando" (false) virou "está falando" (true), ou seja, o
  // servidor confirmou que uma fala nova está começando agora — o caminho
  // local ganha nova chance. Isso é seguro porque é exatamente a mesma
  // condição em que o indicador já ia acender do zero de qualquer forma;
  // não há "meio de fala" pra atravessar.
  //
  // Limite de tentativas (WATCHDOG_MAX_RETRIES): sem isso, um device
  // genuinamente com problema (analyser sempre zerado) tropeçaria de novo a
  // cada início de fala, e o indicador ficaria pingue-pongando entre
  // 'local-volume' e 'server-events' a cada boundary — a forma mais simples
  // de evitar isso é parar de dar chances depois de N tropeços. Passado o
  // limite, o comportamento antigo volta: acionado pro resto do mount.
  const watchdogTrippedRef = React.useRef(false);
  const watchdogRetriesRef = React.useRef(0);
  const serverSpeakingSinceRef = React.useRef<number | null>(null);
  const prevServerIsSpeakingRef = React.useRef(false);

  React.useEffect(() => {
    const isCleanRiseBoundary = serverIsSpeaking && !prevServerIsSpeakingRef.current;
    prevServerIsSpeakingRef.current = serverIsSpeaking;

    if (
      watchdogTrippedRef.current &&
      isCleanRiseBoundary &&
      watchdogRetriesRef.current < WATCHDOG_MAX_RETRIES
    ) {
      watchdogTrippedRef.current = false;
      watchdogRetriesRef.current += 1;
    }

    if (!canUseLocalVolume || watchdogTrippedRef.current) {
      if (!serverIsSpeaking) {
        serverSpeakingSinceRef.current = null;
      }
      return;
    }
    if (!serverIsSpeaking) {
      serverSpeakingSinceRef.current = null;
      return;
    }
    if (serverSpeakingSinceRef.current === null) {
      serverSpeakingSinceRef.current = Date.now();
    }
    // checagem pontual: se já passou o suficiente falando (segundo o
    // servidor) sem o local nunca ter acusado nada, desiste do local.
    if (rawLevel < riseThreshold && Date.now() - serverSpeakingSinceRef.current >= watchdogMs) {
      watchdogTrippedRef.current = true;
    }
  }, [canUseLocalVolume, serverIsSpeaking, rawLevel, riseThreshold, watchdogMs]);

  const useLocalVolume = canUseLocalVolume && !watchdogTrippedRef.current;

  // --- Modo de calibração: coleta e loga estatísticas, só se ligado --------
  //
  // Lido uma vez por mount (mesmo padrão de `audioApiSupported` acima) — pra
  // ligar/desligar em runtime, dá F5. Ver o "COMO USAR" no bloco de
  // constantes no topo do arquivo.
  const calibrationEnabled = React.useRef(loadCalibrationModeEnabled()).current;
  const calibrationStatsRef = React.useRef<{
    min: number;
    max: number;
    sum: number;
    count: number;
    windowStart: number;
  } | null>(null);

  React.useEffect(() => {
    // Flag desligada (o caso normal): um `if` e nada mais — sem array, sem
    // console.log, sem custo por tick.
    if (!calibrationEnabled || !useLocalVolume) {
      return;
    }
    const now = Date.now();
    const stats = calibrationStatsRef.current;
    if (!stats) {
      calibrationStatsRef.current = {
        min: rawLevel,
        max: rawLevel,
        sum: rawLevel,
        count: 1,
        windowStart: now,
      };
      return;
    }
    stats.min = Math.min(stats.min, rawLevel);
    stats.max = Math.max(stats.max, rawLevel);
    stats.sum += rawLevel;
    stats.count += 1;
    if (now - stats.windowStart < CALIBRATION_LOG_INTERVAL_MS) {
      return;
    }
    const who = participant?.identity || participant?.name || '(sem participant)';
    console.log(
      `[concord-calibração] ${who} nível min=${stats.min.toFixed(3)} max=${stats.max.toFixed(3)} média=${(
        stats.sum / stats.count
      ).toFixed(3)} (n=${stats.count})`,
    );
    calibrationStatsRef.current = {
      min: rawLevel,
      max: rawLevel,
      sum: rawLevel,
      count: 1,
      windowStart: now,
    };
  }, [calibrationEnabled, useLocalVolume, rawLevel, participant]);

  // --- Histerese + hold do caminho local ------------------------------------
  const [localIsSpeaking, setLocalIsSpeaking] = React.useState(false);
  const holdTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoldTimer = React.useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!useLocalVolume) {
      // Trocou de fonte (ou nunca teve local pra usar) — não deixa um timer
      // órfão do caminho local acender/apagar o estado depois.
      clearHoldTimer();
      setLocalIsSpeaking(false);
      return;
    }

    if (rawLevel >= riseThreshold) {
      clearHoldTimer();
      setLocalIsSpeaking(true);
      return;
    }

    if (rawLevel < fallThreshold) {
      // Já agendado? não reagenda — o hold conta a partir da PRIMEIRA vez
      // que caiu abaixo do limiar de descida, não fica sendo empurrado pra
      // frente por flutuações pequenas dentro da zona de silêncio.
      setLocalIsSpeaking((current) => {
        if (current && holdTimerRef.current === null) {
          holdTimerRef.current = setTimeout(() => {
            holdTimerRef.current = null;
            setLocalIsSpeaking(false);
          }, holdMs);
        }
        return current;
      });
    }
    // Entre os dois limiares: zona ambígua, não mexe em nada — nem acende
    // nem agenda apagar. É a segunda perna da histerese.
  }, [useLocalVolume, rawLevel, riseThreshold, fallThreshold, holdMs, clearHoldTimer]);

  // Limpeza do timer de hold no unmount.
  React.useEffect(() => clearHoldTimer, [clearHoldTimer]);

  if (useLocalVolume) {
    return { isSpeaking: localIsSpeaking, level: rawLevel, source: 'local-volume' };
  }

  // Fallback: o servidor já aplica a própria suavização (ver nota sobre
  // `livekit.yaml` no HANDOFF) — replicar histerese em cima disso só
  // adicionaria atraso extra a um caminho que já é o mais lento dos dois,
  // então repassamos o booleano do servidor direto.
  return { isSpeaking: serverIsSpeaking, level: null, source: 'server-events' };
}
