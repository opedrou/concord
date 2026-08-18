'use client';

import * as React from 'react';
import { Track } from 'livekit-client';
import { useLocalParticipant } from '@livekit/components-react';
import { VideoIcon } from '@/lib/icons';
import {
  QUALITY_OPTIONS,
  QualityKey,
  findQuality,
  loadQualityPref,
  saveQualityPref,
} from '@/lib/screenShareQuality';
import styles from '../styles/ScreenShareQualityControl.module.css';

/**
 * Dropdown pra pessoa escolher a qualidade da propria transmissao de tela.
 *
 * Fica fora da ControlBar porque `ControlBarProps` do @livekit/components-react
 * nao tem slot pra injetar controle — mesmo motivo que ja levou o painel de
 * volume e o controle de ruido a virarem botoes flutuantes proprios.
 *
 * A escolha vale pra PROXIMA vez que a tela for compartilhada: trocar o
 * encoding de uma track ja publicada exigiria republicar (o navegador reabriria
 * a caixinha de selecao de tela), o que seria pior que esperar o proximo
 * compartilhamento. Por isso, se ja estiver transmitindo, avisamos em vez de
 * fingir que trocou.
 */
export function ScreenShareQualityControl() {
  const [quality, setQuality] = React.useState<QualityKey>(loadQualityPref);
  const { localParticipant } = useLocalParticipant();

  // Se ja esta transmitindo, a troca so vale no proximo compartilhamento.
  const isSharing = !!localParticipant?.getTrackPublication(Track.Source.ScreenShare);

  const handleChange = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value as QualityKey;
    setQuality(next);
    saveQualityPref(next);
  }, []);

  const current = findQuality(quality);

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor="screenshare-quality">
        <VideoIcon size={16} />
        <span className={styles.labelText}>Qualidade da transmissão</span>
      </label>
      <select
        id="screenshare-quality"
        className={`lk-button ${styles.select}`}
        value={quality}
        onChange={handleChange}
        title={current.hint}
      >
        {QUALITY_OPTIONS.map((option) => (
          <option key={option.key} value={option.key} title={option.hint}>
            {option.label}
          </option>
        ))}
      </select>
      <p className={styles.hint}>{current.hint}</p>
      {isSharing && (
        <p className={styles.warning}>
          Você já está transmitindo — a nova qualidade vale a partir do próximo compartilhamento.
        </p>
      )}
    </div>
  );
}
