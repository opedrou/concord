'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useMicProcessor } from './MicProcessorContext';
import { NOISE_LEVELS, noiseLevelDescription, noiseLevelLabel, type NoiseLevel } from './denoise';
import { GATE_MAX, GATE_MIN, dbToMeterFraction, markGateThresholdTouched } from './micProcessor';
import type { DenoiseStatus } from './micProcessor';
import { tierLabel } from './noiseSuppression';
import { MicIcon, SettingsIcon } from '@/lib/icons';
import styles from '../styles/SettingsPanel.module.css';

/**
 * Painel unico de configuracoes, aberto pela engrenagem da `ChannelSidebar`.
 *
 * Antes havia DUAS engrenagens: uma na barra de controles da chamada (audio) e
 * outra na sidebar (conta). Agora e uma so, com as duas coisas em secoes —
 * pedido do dono.
 *
 * Este componente e burro de proposito: nao conhece LiveKit, nao segura
 * processor nenhum, e pode desmontar a vontade quando o painel fecha. Quem
 * mantem o processamento de audio vivo e o `<MicProcessorBinder />`, montado
 * dentro do `RoomContext` — ver o desenho no topo de MicProcessorContext.tsx.
 */
export function SettingsPanel(props: {
  isAdmin: boolean;
  onLogout?: () => void;
  onNavigate?: () => void;
}) {
  const mic = useMicProcessor();

  // PORTAL: o painel e renderizado no <body>, nao no lugar em que aparece na
  // arvore (dentro da .sidebar). A .sidebar tem `overflow-y: auto`, e por spec
  // isso torna o `overflow-x` dela `auto` tambem — qualquer coisa mais larga
  // que a sidebar corre risco de recorte ali dentro. O `position: fixed`
  // sozinho protege enquanto nenhum ancestral criar containing block (um
  // `transform`/`filter`/`contain` a mais em qualquer pai da sidebar quebraria
  // o painel em silencio, sem erro de build). Portalizando, a questao deixa de
  // existir por construcao.
  //
  // O <body> carrega `data-lk-theme="default"` (app/layout.tsx), entao as
  // variaveis --lk-* continuam resolvendo aqui.
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    // Só depois da montagem: no SSR nao existe `document`.
    setPortalTarget(document.body);
  }, []);

  const panel = (
    <div className={styles.panel} role="dialog" aria-label="Configurações">
      <header className={styles.header}>
        <SettingsIcon size={15} />
        <h2 className={styles.title}>Configurações</h2>
      </header>

      {mic && (
        <section className={styles.section} aria-labelledby="settings-audio-heading">
          <h3 className={styles.sectionTitle} id="settings-audio-heading">
            Áudio
          </h3>
          {mic.active ? (
            <AudioSettings mic={mic} />
          ) : (
            <p className={styles.hint}>
              Entre num canal de voz para ajustar microfone e redução de ruído.
            </p>
          )}
        </section>
      )}

      <section className={styles.section} aria-labelledby="settings-account-heading">
        <h3 className={styles.sectionTitle} id="settings-account-heading">
          Conta
        </h3>
        <div className={styles.accountLinks}>
          <a href="/profile" className={styles.accountItem} onClick={props.onNavigate}>
            Perfil
          </a>
          {props.isAdmin && (
            <a href="/admin" className={styles.accountItem} onClick={props.onNavigate}>
              Admin
            </a>
          )}
          <button
            type="button"
            className={styles.accountItem}
            onClick={() => {
              props.onNavigate?.();
              props.onLogout?.();
            }}
          >
            Sair
          </button>
        </div>
      </section>
    </div>
  );

  // Antes do efeito de montagem rodar, renderiza no lugar (comportamento
  // antigo) em vez de nao renderizar nada — o painel so abre por clique, entao
  // na pratica o alvo ja existe, mas isso evita um frame vazio.
  return portalTarget ? createPortal(panel, portalTarget) : panel;
}

type Mic = NonNullable<ReturnType<typeof useMicProcessor>>;

function AudioSettings({ mic }: { mic: Mic }) {
  return (
    <>
      <NoiseLevelPicker mic={mic} />
      <GateSlider mic={mic} />

      {mic.monitorDevice && (
        <p className={styles.warning}>
          Dispositivo &quot;Monitor of...&quot; detectado (áudio do sistema como microfone). Redução
          de ruído e um limiar alto destroem esse áudio — deixamos os dois desligados por padrão;
          mexa só se souber o que está fazendo.
        </p>
      )}

      {mic.processorFailed && (
        <p className={styles.warning}>
          Não foi possível processar o microfone neste navegador — ele continua funcionando
          normalmente, só sem redução de ruído nem controle de sensibilidade.
        </p>
      )}
    </>
  );
}

/** Frase de status da camada escolhida — o que está ACONTECENDO de verdade,
 * nunca só o que foi pedido. Uma escolha que falhou em silêncio é pior que
 * nenhuma escolha. */
function statusMessage(
  level: NoiseLevel,
  status: DenoiseStatus,
  browserTier: string,
): string | null {
  if (level === 'off') {
    return null;
  }
  if (level === 'browser') {
    return `Aplicada: ${browserTier}.`;
  }
  switch (status) {
    case 'active':
      return 'Ativa e processando.';
    case 'loading':
      return 'Carregando o modelo… o áudio segue passando normalmente.';
    case 'unsupported':
      return 'Este navegador não tem AudioWorklet — sem redução de ruído neural aqui.';
    case 'wrong-sample-rate':
      return 'O sistema não está a 48 kHz, taxa que o modelo exige. Tente outro dispositivo de áudio.';
    case 'failed':
      return 'Falha ao carregar o modelo. O microfone continua funcionando, sem essa camada.';
    case 'off':
    default:
      return null;
  }
}

function NoiseLevelPicker({ mic }: { mic: Mic }) {
  const message = statusMessage(mic.noiseLevel, mic.denoiseStatus, tierLabel(mic.browserTier));
  const degraded =
    mic.denoiseStatus === 'failed' ||
    mic.denoiseStatus === 'unsupported' ||
    mic.denoiseStatus === 'wrong-sample-rate';

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Redução de ruído</span>
      <div className={styles.segmented} role="radiogroup" aria-label="Redução de ruído">
        {NOISE_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={mic.noiseLevel === level}
            className={`${styles.segment} ${mic.noiseLevel === level ? styles.segmentActive : ''}`}
            onClick={() => mic.setNoiseLevel(level)}
            title={noiseLevelDescription(level)}
          >
            {noiseLevelLabel(level)}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{noiseLevelDescription(mic.noiseLevel)}</p>
      {message && <p className={degraded ? styles.warning : styles.status}>{message}</p>}
    </div>
  );
}

/**
 * Sensibilidade de entrada, estilo "Input Sensitivity" do Discord. O medidor ao
 * vivo escreve numa CSS custom property em vez de passar por estado do React:
 * o nivel chega a ~33Hz e re-renderizar nessa cadencia seria desperdicio.
 */
function GateSlider({ mic }: { mic: Mic }) {
  const fillRef = React.useRef<HTMLDivElement | null>(null);
  const { subscribeLevel } = mic;

  React.useEffect(() => {
    return subscribeLevel((levelDb) => {
      const frac = dbToMeterFraction(levelDb);
      fillRef.current?.style.setProperty('--mic-gate-level', `${(frac * 100).toFixed(1)}%`);
    });
  }, [subscribeLevel]);

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      mic.setThreshold(Number(event.target.value));
      markGateThresholdTouched();
    },
    [mic],
  );

  const thresholdPct = ((mic.threshold - GATE_MIN) / (GATE_MAX - GATE_MIN)) * 100;
  const valueText =
    mic.threshold <= GATE_MIN
      ? 'Desligado — microfone sempre aberto'
      : `${mic.threshold} de 100 — corta o áudio abaixo desse nível`;

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor="mic-gate-threshold">
        <MicIcon size={14} />
        <span>Sensibilidade de entrada</span>
      </label>

      <div
        className={styles.meter}
        style={{ '--mic-gate-threshold': `${thresholdPct}%` } as React.CSSProperties}
      >
        {/* Duas camadas com o MESMO gradiente (âmbar antes do limiar, verde
            depois), uma apagada e outra acesa — igual ao Discord: a trilha
            inteira aparece em tom escuro, e o pedaço correspondente ao nível
            ao vivo do microfone acende por cima. Assim dá pra ler ao mesmo
            tempo ONDE está o limiar (troca de cor) e QUANTO o mic está
            captando agora (até onde vai o tom aceso). */}
        <div className={styles.meterDim} />
        <div className={styles.meterActive} ref={fillRef} />
        <input
          id="mic-gate-threshold"
          className={styles.rangeInput}
          type="range"
          min={GATE_MIN}
          max={GATE_MAX}
          step={1}
          value={mic.threshold}
          onChange={handleChange}
          aria-label="Sensibilidade de entrada do microfone"
          aria-valuetext={valueText}
        />
      </div>

      <p className={styles.hint}>
        {mic.threshold <= GATE_MIN
          ? 'Gate desligado — o microfone transmite o tempo todo.'
          : 'Abaixo da marca, o áudio não é transmitido. A barra mostra o nível do seu mic ao vivo.'}
      </p>
    </div>
  );
}
