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
   * proposito — histerese classica, evita que ruido de fundo ou respiracao
   * fiquem cruzando o limiar pra frente e pra tras. */
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
   * ver "watchdog" no corpo do hook) e usarmos so o sinal do servidor dali
   * em diante, pro resto da vida desse mount. */
  watchdogMs?: number;
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

const DEFAULT_RISE_THRESHOLD = 0.08;
const DEFAULT_FALL_THRESHOLD = 0.03;
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

// fftSize baixo de proposito: e o mesmo default que o useTrackVolume ja usa
// (32 — ver hooks-C7fu1g_i.mjs dentro do pacote), só estamos sendo explicitos
// pra não depender de um default que a lib pode mudar num upgrade "alpha".
// Com 5 participantes numa call isso da 5 AnalyserNode de 32 bins cada, e
// cada um roda um setInterval a ~30fps por dentro do proprio hook da lib —
// custo desprezivel comparado a qualquer coisa de video. smoothingTimeConstant
// um pouco acima do default (0) tira ruido de amostra-a-amostra na origem,
// mas a suavizacao temporal de verdade (o que evita o piscar) e a histerese
// abaixo, nao isso.
const ANALYSER_OPTIONS = { fftSize: 32, smoothingTimeConstant: 0.15 } as const;

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
 * @param options Limiares/tempos de histerese e do watchdog — os defaults
 *   foram calibrados pra "parecer natural" numa call de voz normal, não pra
 *   parecer o mais rápido possível (ver comentários nos defaults).
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
  const rawLevel = useTrackVolume(trackForVolumeHook, ANALYSER_OPTIONS);

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
  // verdade do servidor. Uma vez acionado, fica acionado (não volta a
  // confiar no local nesse mount) — evita alternar de fonte no meio de uma
  // fala, o que seria mais confuso que só ficar no fallback.
  const watchdogTrippedRef = React.useRef(false);
  const serverSpeakingSinceRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!canUseLocalVolume || watchdogTrippedRef.current) {
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
