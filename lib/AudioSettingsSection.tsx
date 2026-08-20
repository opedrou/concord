'use client';

// Seção "Voz e vídeo" da janela de configurações: redução de ruído,
// sensibilidade de entrada (com medidor ao vivo), ganho de entrada e escolha
// dos dispositivos.
//
// Este componente é BURRO de propósito: não conhece LiveKit, não segura
// processor nenhum, e pode desmontar à vontade quando a janela fecha. Quem
// mantém o processamento de áudio vivo é o `<MicProcessorBinder />`, montado
// dentro do `RoomContext` — ver o desenho no topo de MicProcessorContext.tsx.
//
// Veio inteiro do antigo `SettingsPanel.tsx` (o popover de 20rem que a
// engrenagem abria), com a lógica intacta; o que mudou foi só onde mora.

import * as React from 'react';
import { MediaDeviceMenu } from '@livekit/components-react';
import { useMicProcessor } from './MicProcessorContext';
import { NOISE_LEVELS, noiseLevelDescription, noiseLevelLabel, type NoiseLevel } from './denoise';
import {
  DEFAULT_INPUT_GAIN,
  GATE_MAX,
  GATE_MIN,
  INPUT_GAIN_MAX,
  INPUT_GAIN_MIN,
  dbToMeterFraction,
  markGateThresholdTouched,
} from './micProcessor';
import type { DenoiseStatus } from './micProcessor';
import { tierLabel } from './noiseSuppression';
import { useVolumeMixer } from './VolumeMixerContext';
import { MicIcon } from '@/lib/icons';
import styles from '../styles/SettingsWindow.module.css';

type Mic = NonNullable<ReturnType<typeof useMicProcessor>>;

export function AudioSettingsSection() {
  const mic = useMicProcessor();

  return (
    <>
      <DeviceSettings />
      {mic ? (
        mic.active ? (
          <MicSettings mic={mic} />
        ) : (
          <p className={styles.hint}>
            Entre num canal de voz para ajustar microfone e redução de ruído.
          </p>
        )
      ) : null}
    </>
  );
}

/**
 * Entrada e saída de áudio. O `MediaDeviceMenu` do @livekit/components-react
 * consegue ENUMERAR dispositivos sem Room, mas quem aplica a saída é o
 * `room.switchActiveDevice`, que só existe dentro do `RoomContext` — por isso
 * a escolha passa pelo `VolumeMixerContext` (comando) e é o
 * `<VolumeMixerBinder />` quem executa. Mesmo caminho do `setThreshold`.
 */
function DeviceSettings() {
  const mixer = useVolumeMixer();

  // `setSinkId` não existe no Firefox — sem ele o navegador toca sempre no
  // dispositivo padrão do sistema e não há o que escolher. Melhor dizer isso
  // do que oferecer um seletor que não faz nada.
  const [canChooseOutput, setCanChooseOutput] = React.useState(true);
  React.useEffect(() => {
    setCanChooseOutput(
      typeof window !== 'undefined' &&
        (typeof AudioContext !== 'undefined'
          ? 'setSinkId' in AudioContext.prototype
          : false || 'setSinkId' in HTMLMediaElement.prototype),
    );
  }, []);

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Dispositivos</span>
      <div className={styles.deviceRow}>
        <span className={styles.deviceLabel}>Microfone</span>
        <MediaDeviceMenu kind="audioinput" />
      </div>
      <div className={styles.deviceRow}>
        <span className={styles.deviceLabel}>Saída de áudio</span>
        {canChooseOutput ? (
          <MediaDeviceMenu
            kind="audiooutput"
            onActiveDeviceChange={(_kind, deviceId) => mixer?.setOutputDeviceId(deviceId || null)}
          />
        ) : (
          <span className={styles.hint}>
            Seu navegador não permite escolher a saída — use a configuração do sistema.
          </span>
        )}
      </div>
      <div className={styles.deviceRow}>
        <span className={styles.deviceLabel}>Câmera</span>
        <MediaDeviceMenu kind="videoinput" />
      </div>
    </div>
  );
}

function MicSettings({ mic }: { mic: Mic }) {
  return (
    <>
      <NoiseLevelPicker mic={mic} />
      <GateSlider mic={mic} />
      <InputGainSlider mic={mic} />

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
 * o nível chega a ~33Hz e re-renderizar nessa cadência seria desperdício.
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

/**
 * Ganho de entrada (pré-amplificador). Fica ANTES do medidor na cadeia de
 * áudio, então a barra da sensibilidade já mostra o efeito — que é justamente
 * como se ajusta os dois juntos: sobe o ganho até a fala normal encostar bem
 * acima da marca do gate.
 */
function InputGainSlider({ mic }: { mic: Mic }) {
  const percent = Math.round(mic.inputGain * 100);
  const db = 20 * Math.log10(mic.inputGain);

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor="mic-input-gain">
        <span>Ganho de entrada</span>
        <span className={styles.fieldValue}>
          {percent}% ({db >= 0 ? '+' : '−'}
          {Math.abs(db).toFixed(1)} dB)
        </span>
      </label>
      <input
        id="mic-input-gain"
        className={styles.plainRange}
        type="range"
        min={INPUT_GAIN_MIN}
        max={INPUT_GAIN_MAX}
        step={0.05}
        value={mic.inputGain}
        onChange={(e) => mic.setInputGain(Number(e.target.value))}
        aria-label="Ganho de entrada do microfone"
        aria-valuetext={`${percent} por cento`}
      />
      <p className={styles.hint}>
        Amplifica o microfone antes de sair. Use quando sua voz chega baixa mesmo com o volume do
        sistema no máximo.
      </p>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={mic.autoGainControl}
          onChange={(e) => mic.setAutoGainControl(e.target.checked)}
        />
        <span>Controle automático de ganho do navegador</span>
      </label>
      <p
        className={
          mic.autoGainControl && mic.inputGain !== DEFAULT_INPUT_GAIN ? styles.warning : styles.hint
        }
      >
        {mic.autoGainControl && mic.inputGain !== DEFAULT_INPUT_GAIN
          ? 'O automático está ligado junto com o ganho manual: ele vai normalizar o nível e desfazer boa parte do seu ajuste.'
          : 'O automático nivela sua voz sozinho, mas briga com o ganho manual — mexer no ganho acima desliga ele.'}
      </p>
    </div>
  );
}
