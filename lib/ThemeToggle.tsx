'use client';

// Botao sol/lua da barra do usuario (ver o projeto de design). Escuro e o
// padrao — e o tema em que o app nasceu e o que o dono usa.
//
// O estado NAO mora em React: mora num atributo do <html>. Duas razoes.
// A primeira e que o tema precisa estar aplicado antes da primeira pintura,
// senao a tela pisca escura e depois vira clara — e nada em React roda antes
// disso (por isso o script inline no app/layout.tsx). A segunda e que o CSS ja
// e a fonte da verdade: quem le `data-concord-theme` e a folha de estilo, nao
// componente nenhum. Guardar o mesmo dado tambem num contexto so criaria duas
// versoes pra ficarem fora de sincronia.

import * as React from 'react';
import { SunIcon, MoonIcon } from '@/lib/icons';

export const THEME_STORAGE_KEY = 'concord:theme';

/** Avisa quem desenha o botao que o tema mudou em OUTRO lugar (a secao
 *  Aparencia das configuracoes). Sem isto o icone do sol/lua ficaria mostrando
 *  o tema antigo ate o proximo render. */
export const THEME_CHANGE_EVENT = 'concord:theme-change';

type Theme = 'dark' | 'light';

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.concordTheme === 'light' ? 'light' : 'dark';
}

export function ThemeToggle({ className }: { className?: string }) {
  // Comeca sempre em 'dark' e corrige no efeito: no servidor nao existe
  // <html> pra consultar, e devolver valores diferentes nos dois lados daria
  // erro de hidratacao.
  const [theme, setTheme] = React.useState<Theme>('dark');
  React.useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, sync);
  }, []);

  const toggle = React.useCallback(() => {
    const next: Theme = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.concordTheme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Modo privado/quota: o tema vale pra esta aba e nao persiste. Melhor
      // que derrubar o clique.
    }
    setTheme(next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const label = theme === 'light' ? 'Usar tema escuro' : 'Usar tema claro';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={label} title={label}>
      {theme === 'light' ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    </button>
  );
}
