'use client';

// Secao "Aparencia" das configuracoes: tema (claro/escuro) e o estilo do anel
// que envolve o tile de quem esta falando.
//
// Mesmo desenho do <ThemeToggle />: o estado mora num atributo do <html>, nao
// em React. Quem le esses atributos e a folha de estilo — guardar o mesmo dado
// tambem num contexto so criaria duas versoes pra sairem de sincronia. Ver a
// nota longa em lib/ThemeToggle.tsx.

import * as React from 'react';
import { THEME_STORAGE_KEY, THEME_CHANGE_EVENT } from '@/lib/ThemeToggle';
import styles from '../styles/SettingsWindow.module.css';

export const RING_STORAGE_KEY = 'concord:ring';

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
  React.useEffect(() => {
    setRing(readRing());
    setTheme(readTheme());
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
          <option value="continuo">Contínua — anel inteiro em volta do tile</option>
          <option value="recortado">Recortada — só as laterais, como estava antes</option>
        </select>
        <p className={styles.hint}>
          A borda vem de um pseudo-elemento com raio próprio. Quando ele não acompanha o canto do
          tile, os cantos do anel somem no recorte e sobra só o meio das laterais — que é a versão
          &quot;recortada&quot;. Ficou como opcao a pedido.
        </p>
      </div>
    </>
  );
}
