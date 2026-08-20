'use client';

// Editor de corte de um som da soundboard: forma de onda, duas alças (início e
// fim) e prévia.
//
// O CORTE NÃO REESCREVE O ARQUIVO. O que é salvo são dois números
// (`trimStart`/`trimEnd`) que o `playSfx` aplica no `start(when, offset,
// duration)` da Web Audio na hora de tocar. Motivo: cortar de verdade exigiria
// decodificar e reencodar no servidor (ffmpeg na imagem, MP3 recodificado a
// cada ajuste) e tornaria a decisão irreversível — do jeito atual dá pra
// afrouxar o corte depois e o áudio original nunca se degrada.
//
// A forma de onda vem do mesmo `AudioBuffer` que já é baixado e decodificado
// pra tocar (cache em lib/sfx.ts): abrir o editor não gera download novo.

import * as React from 'react';
import { apiErrorMessage, updateSound, type Sound } from '@/lib/api-client';
import { loadSoundBuffer, playSfx, stopAllSfx } from '@/lib/sfx';
import styles from '../styles/Soundboard.module.css';

/** Quantas colunas a forma de onda tem. Fixo: é um efeito de 1–3s. */
const PEAK_COUNT = 160;

/** Não dá pra cortar um pedaço menor que isso — vira clique, não som. */
const MIN_LENGTH_SECONDS = 0.05;

export function SoundTrimmer(props: {
  sound: Sound;
  onSaved: (sound: Sound) => void;
  onClose: () => void;
}) {
  const { sound } = props;
  const [duration, setDuration] = React.useState<number | null>(null);
  const [peaks, setPeaks] = React.useState<Float32Array | null>(null);
  const [start, setStart] = React.useState(sound.trimStart);
  const [end, setEnd] = React.useState<number | null>(sound.trimEnd);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadSoundBuffer(sound.url).then((buffer) => {
      if (cancelled) return;
      if (!buffer) {
        setError('Não deu pra ler o áudio deste som.');
        return;
      }
      setDuration(buffer.duration);
      setPeaks(computePeaks(buffer));
      // Corte gravado além do fim do arquivo (arquivo trocado, valor antigo):
      // encolhe pro que existe em vez de mostrar alça fora da faixa.
      setStart((v) => Math.min(v, Math.max(buffer.duration - MIN_LENGTH_SECONDS, 0)));
      setEnd((v) => (v === null ? null : Math.min(v, buffer.duration)));
    });
    return () => {
      cancelled = true;
    };
  }, [sound.url]);

  // Sair do editor não deixa a prévia tocando.
  React.useEffect(() => () => stopAllSfx(), []);

  const effectiveEnd = end ?? duration ?? 0;

  const setFromPointer = React.useCallback(
    (clientX: number, which: 'start' | 'end') => {
      const track = trackRef.current;
      if (!track || duration === null) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const seconds = ratio * duration;
      if (which === 'start') {
        setStart(Math.min(seconds, (end ?? duration) - MIN_LENGTH_SECONDS));
      } else {
        setEnd(Math.max(seconds, start + MIN_LENGTH_SECONDS));
      }
    },
    [duration, end, start],
  );

  const handlePointerDown = React.useCallback(
    (which: 'start' | 'end') => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      // `setPointerCapture` no próprio alvo: o arraste continua valendo mesmo
      // quando o ponteiro sai da faixa (é fácil passar do fim ao arrastar).
      event.currentTarget.setPointerCapture(event.pointerId);
      setFromPointer(event.clientX, which);
    },
    [setFromPointer],
  );

  const handlePointerMove = React.useCallback(
    (which: 'start' | 'end') => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        setFromPointer(event.clientX, which);
      }
    },
    [setFromPointer],
  );

  const handleSave = React.useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateSound(sound.id, {
        trimStart: round(start),
        // Fim colado no fim do arquivo vira `null` — "toca tudo" é o estado
        // certo pra guardar, e sobrevive a uma troca de arquivo depois.
        trimEnd: duration !== null && effectiveEnd >= duration - 0.01 ? null : round(effectiveEnd),
      });
      props.onSaved(updated);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [duration, effectiveEnd, props, sound.id, start]);

  const startRatio = duration ? start / duration : 0;
  const endRatio = duration ? effectiveEnd / duration : 1;

  return (
    <div className={styles.trimmer}>
      <div className={styles.trimmerHeader}>
        <span className={styles.settingsName}>Cortar “{sound.name}”</span>
        <span className={styles.trimmerTimes}>
          {formatSeconds(start)} → {formatSeconds(effectiveEnd)} (
          {formatSeconds(Math.max(effectiveEnd - start, 0))})
        </span>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {duration === null && !error ? (
        <p className={styles.hint}>Carregando áudio…</p>
      ) : (
        <div className={styles.track} ref={trackRef}>
          <Waveform peaks={peaks} startRatio={startRatio} endRatio={endRatio} />
          {/* Faixas escuras = o que foi cortado fora. */}
          <div className={styles.trimmed} style={{ left: 0, width: `${startRatio * 100}%` }} />
          <div
            className={styles.trimmed}
            style={{ left: `${endRatio * 100}%`, right: 0, width: 'auto' }}
          />
          <div
            className={styles.handle}
            style={{ left: `${startRatio * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Início"
            aria-valuemin={0}
            aria-valuemax={effectiveEnd}
            aria-valuenow={start}
            aria-valuetext={formatSeconds(start)}
            onPointerDown={handlePointerDown('start')}
            onPointerMove={handlePointerMove('start')}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.5 : 0.05;
              if (e.key === 'ArrowLeft') setStart((v) => Math.max(v - step, 0));
              if (e.key === 'ArrowRight')
                setStart((v) => Math.min(v + step, effectiveEnd - MIN_LENGTH_SECONDS));
            }}
          />
          <div
            className={styles.handle}
            style={{ left: `${endRatio * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Fim"
            aria-valuemin={start}
            aria-valuemax={duration ?? 0}
            aria-valuenow={effectiveEnd}
            aria-valuetext={formatSeconds(effectiveEnd)}
            onPointerDown={handlePointerDown('end')}
            onPointerMove={handlePointerMove('end')}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.5 : 0.05;
              if (e.key === 'ArrowLeft')
                setEnd((v) => Math.max((v ?? duration ?? 0) - step, start + MIN_LENGTH_SECONDS));
              if (e.key === 'ArrowRight')
                setEnd((v) => Math.min((v ?? duration ?? 0) + step, duration ?? 0));
            }}
          />
        </div>
      )}

      <div className={styles.trimmerActions}>
        {/* Prévia só pra você, com o corte que está na tela — nada disso vai
            pro grupo até salvar. */}
        <button
          type="button"
          className="lk-button"
          onClick={() => {
            stopAllSfx();
            playSfx(sound.url, { gain: 1, start, end: effectiveEnd });
          }}
          disabled={duration === null}
        >
          Ouvir corte
        </button>
        <button type="button" className="lk-button" onClick={() => stopAllSfx()}>
          Parar
        </button>
        <button
          type="button"
          className="lk-button"
          onClick={() => {
            setStart(0);
            setEnd(null);
          }}
          disabled={duration === null}
        >
          Som inteiro
        </button>
        <button
          type="button"
          className="lk-button"
          onClick={() => void handleSave()}
          disabled={saving || duration === null}
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="lk-button" onClick={props.onClose}>
          Fechar
        </button>
      </div>

      <p className={styles.hint}>
        O corte vale pra todo mundo e não apaga nada: o arquivo continua inteiro, dá pra afrouxar
        depois.
      </p>
    </div>
  );
}

/** Canvas em vez de 160 divs: é um desenho, não estrutura. */
function Waveform(props: { peaks: Float32Array | null; startRatio: number; endRatio: number }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const peaks = props.peaks;
    if (!canvas || !peaks) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(Math.round(rect.width * dpr), 1);
    canvas.height = Math.max(Math.round(rect.height * dpr), 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = canvas.width / peaks.length;
    const middle = canvas.height / 2;
    for (let i = 0; i < peaks.length; i += 1) {
      const ratio = (i + 0.5) / peaks.length;
      const inside = ratio >= props.startRatio && ratio <= props.endRatio;
      ctx.fillStyle = inside ? 'rgba(120, 180, 255, 0.95)' : 'rgba(255, 255, 255, 0.25)';
      const height = Math.max(peaks[i] * canvas.height, dpr);
      ctx.fillRect(i * barWidth, middle - height / 2, Math.max(barWidth - dpr, dpr), height);
    }
  }, [props.peaks, props.startRatio, props.endRatio]);

  return <canvas ref={canvasRef} className={styles.waveform} />;
}

/**
 * Pico (maior valor absoluto) de cada fatia, só do primeiro canal: a forma de
 * onda é referência visual pra achar onde o som começa, não análise.
 */
function computePeaks(buffer: AudioBuffer): Float32Array {
  const data = buffer.getChannelData(0);
  const perBucket = Math.max(Math.floor(data.length / PEAK_COUNT), 1);
  const peaks = new Float32Array(PEAK_COUNT);
  for (let i = 0; i < PEAK_COUNT; i += 1) {
    let peak = 0;
    const from = i * perBucket;
    const to = Math.min(from + perBucket, data.length);
    for (let j = from; j < to; j += 1) {
      const value = Math.abs(data[j]);
      if (value > peak) peak = value;
    }
    peaks[i] = peak;
  }
  return peaks;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
