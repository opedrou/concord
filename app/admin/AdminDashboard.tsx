'use client';

import * as React from 'react';
import Link from 'next/link';
import { apiErrorMessage, logout } from '@/lib/api-client';
import { UsersPanel } from './UsersPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { IntegrationsPanel } from './IntegrationsPanel';
import { ShieldIcon } from '@/lib/icons';
import styles from '../../styles/Admin.module.css';

type Tab = 'users' | 'channels' | 'integrations';

export function AdminDashboard({
  currentUsername,
  onClose,
}: {
  currentUsername: string;
  /** Presente quando o painel esta aberto SOBREPOSTO, sem navegar (ver
   * lib/AccountOverlay.tsx) — nesse caso o cabecalho proprio some, porque
   * titulo, "Sair" e "voltar" ja existem em volta. */
  onClose?: () => void;
}) {
  const [tab, setTab] = React.useState<Tab>('users');
  const [logoutError, setLogoutError] = React.useState<string | null>(null);

  const onLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
      window.location.href = '/login';
    } catch (err) {
      setLogoutError(apiErrorMessage(err));
    }
  };

  return (
    <div className={styles.dashboard}>
      {/* Sobreposto, quem da titulo e botao de fechar e o AccountOverlay — este
          cabecalho so existiria pra duplicar os dois. "Sair" tambem ja esta no
          menu de configuracoes que abriu esta janela. */}
      {!onClose && (
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>
              <ShieldIcon size={20} className={styles.titleIcon} />
              Painel de administração
            </h1>
            <p className={styles.subtitle}>Logado como {currentUsername}</p>
          </div>
          <div className={styles.headerActions}>
            <Link className="lk-button" href="/">
              Voltar para o app
            </Link>
            <button className="lk-button" type="button" onClick={onLogout}>
              Sair
            </button>
          </div>
        </header>
      )}
      {logoutError && (
        <p className={styles.error} role="alert">
          {logoutError}
        </p>
      )}

      <nav className={styles.tabs}>
        <button
          className="lk-button"
          type="button"
          aria-pressed={tab === 'users'}
          onClick={() => setTab('users')}
        >
          Pessoas
        </button>
        <button
          className="lk-button"
          type="button"
          aria-pressed={tab === 'channels'}
          onClick={() => setTab('channels')}
        >
          Canais
        </button>
        <button
          className="lk-button"
          type="button"
          aria-pressed={tab === 'integrations'}
          onClick={() => setTab('integrations')}
        >
          Integrações
        </button>
      </nav>

      <section className={styles.panel}>
        {tab === 'users' ? (
          <UsersPanel currentUsername={currentUsername} />
        ) : tab === 'channels' ? (
          <ChannelsPanel />
        ) : (
          <IntegrationsPanel />
        )}
      </section>
    </div>
  );
}
