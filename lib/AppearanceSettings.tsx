'use client';

// Secao "Aparencia" das configuracoes: tema (claro/escuro), o estilo do anel
// que envolve o tile de quem esta falando e o fundo dos tiles de camera
// desligada (chapado ou em degrade).
//
// Mesmo desenho do <ThemeToggle />: o estado mora num atributo do <html>, nao
// em React. Quem le esses atributos e a folha de estilo — guardar o mesmo dado
// tambem num contexto so criaria duas versoes pra sairem de sincronia. Ver a
// nota longa em lib/ThemeToggle.tsx.

import * as React from 'react';
import { THEME_STORAGE_KEY, THEME_CHANGE_EVENT } from '@/lib/ThemeToggle';
import styles from '../styles/SettingsWindow.module.css';

export const RING_STORAGE_KEY = 'concord:ring';
export const TILE_BG_STORAGE_KEY = 'concord:tileBg';

/** `chapado` = a cor dominante da foto, lisa; `degrade` = ela escurecendo pro
 * topo do tile. Quem desenha e o CSS (ver CallParticipantTile.module.css). */
type TileBg = 'chapado' | 'degrade';

function readTileBg(): TileBg {
  if (typeof document === 'undefined') return 'chapado';
  return document.documentElement.dataset.concordTileBg === 'degrade' ? 'degrade' : 'chapado';
}

/** `recortado` = o anel quebrado de antes; `continuo` = anel inteiro. */
type RingStyle = 'continuo' | 'recortado';

function readRing(): RingStyle {
  if (typeof document === 'undefined') return 'continuo';
  return document.documentElement.dataset.concordRing === 'recortado' ? 'recortado' : 'continuo';
}

function readTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.concordTheme === 'light' ? 'light' : 'dark';
}

export function AppearanceSettings() {
  // Nasce no default e corrige no efeito: no servidor nao ha <html> pra
  // consultar, e divergir entre servidor e cliente daria erro de hidratacao.
  const [ring, setRing] = React.useState<RingStyle>('continuo');
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');
  const [tileBg, setTileBg] = React.useState<TileBg>('chapado');
  React.useEffect(() => {
    setRing(readRing());
    setTheme(readTheme());
    setTileBg(readTileBg());
  }, []);

  const applyRing = React.useCallback((value: RingStyle) => {
    if (value === 'recortado') {
      document.documentElement.dataset.concordRing = 'recortado';
    } else {
      delete document.documentElement.dataset.concordRing;
    }
    try {
      window.localStorage.setItem(RING_STORAGE_KEY, value);
    } catch {
      // Modo privado/quota: vale pra esta aba e nao persiste.
    }
    setRing(value);
  }, []);

  const applyTileBg = React.useCallback((value: TileBg) => {
    if (value === 'degrade') {
      document.documentElement.dataset.concordTileBg = 'degrade';
    } else {
      delete document.documentElement.dataset.concordTileBg;
    }
    try {
      window.localStorage.setItem(TILE_BG_STORAGE_KEY, value);
    } catch {
      // Idem.
    }
    setTileBg(value);
  }, []);

  const applyTheme = React.useCallback((value: 'dark' | 'light') => {
    if (value === 'light') {
      document.documentElement.dataset.concordTheme = 'light';
    } else {
      delete document.documentElement.dataset.concordTheme;
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Idem.
    }
    setTheme(value);
    // O botao de sol/lua da sidebar esta montado ao mesmo tempo que esta
    // janela — sem o aviso, o icone dele ficaria no tema antigo.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return (
    <>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="tema-select">
          Tema
        </label>
        <select
          id="tema-select"
          value={theme}
          onChange={(e) => applyTheme(e.target.value as 'dark' | 'light')}
        >
          <option value="dark">Escuro</option>
          <option value="light">Claro</option>
        </select>
        <p className={styles.hint}>O mesmo que o botão de sol/lua na barra de baixo da sidebar.</p>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="anel-select">
          Borda de quem está falando
        </label>
        <select
          id="anel-select"
          value={ring}
          onChange={(e) => applyRing(e.target.value as RingStyle)}
        >
          <option value="continuo">Contínua</option>
          <option value="recortado">Recortada</option>
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="tile-bg-select">
          Fundo dos tiles sem câmera
        </label>
        <select
          id="tile-bg-select"
          value={tileBg}
          onChange={(e) => applyTileBg(e.target.value as TileBg)}
        >
          <option value="chapado">Cor chapada</option>
          <option value="degrade">Degradê</option>
        </select>
        <p className={styles.hint}>
          O degradê escurece o topo do tile, mantendo a cor da foto embaixo.
        </p>
      </div>
    </>
  );
}
