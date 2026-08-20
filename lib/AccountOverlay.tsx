'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/lib/icons';
import styles from '../styles/AccountOverlay.module.css';

/**
 * Janela sobreposta pra Perfil e Admin.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Perfil e Admin eram rotas de verdade (`<a href="/profile">`), e abrir
 * qualquer uma delas durante uma chamada DERRUBAVA a chamada: navegar
 * desmonta o `PageClientImpl`, que agora chama `room.disconnect()` no unmount.
 * A solucao e a mesma que o canal de texto ja usa (ver RoomShell.tsx): em vez
 * de navegar, renderizar o conteudo por cima, dentro da MESMA arvore — assim o
 * `<Room>` nunca desmonta e a voz continua tocando por baixo, como no Discord.
 *
 * Portalizado pro <body> pelo mesmo motivo do SettingsPanel: quem monta isto e
 * a `ChannelSidebar`, que tem `overflow-y: auto` e recortaria qualquer coisa
 * maior que ela. O <body> carrega `data-lk-theme="default"` (app/layout.tsx),
 * entao as variaveis --lk-* continuam resolvendo aqui.
 *
 * As rotas /profile e /admin continuam existindo e funcionando — quem abre a
 * URL direto (ou nao esta em call nenhuma) cai nelas normalmente.
 */
export function AccountOverlay(props: {
  title: string;
  /**
   * `narrow` pro perfil (formulario de uma coluna), `wide` (padrao) pra
   * conteudo com tabela, `large` pras configuracoes — que tem navegacao
   * lateral mais conteudo e nao cabem nos 900px do padrao sem ficar
   * apertadas.
   */
  size?: 'narrow' | 'wide' | 'large';
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const { onClose } = props;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    // `capture` pra fechar antes que algum atalho global da call (ver
    // KeyboardShortcuts.tsx) leia a mesma tecla.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const overlay = (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={`${styles.window} ${props.size === 'narrow' ? styles.windowNarrow : ''} ${
          props.size === 'large' ? styles.windowLarge : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        // Clique DENTRO da janela nao fecha — so o backdrop.
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h1 className={styles.title}>{props.title}</h1>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            <CloseIcon size={16} />
          </button>
        </header>
        <div className={styles.body}>{props.children}</div>
      </div>
    </div>
  );

  return portalTarget ? createPortal(overlay, portalTarget) : null;
}
