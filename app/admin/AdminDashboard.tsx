'use client';

import * as React from 'react';
import Link from 'next/link';
import { apiErrorMessage, logout } from '@/lib/api-client';
import { UsersPanel } from './UsersPanel';
import { ChannelsPanel } from './ChannelsPanel';
import styles from '../../styles/Admin.module.css';

type Tab = 'users' | 'channels';

export function AdminDashboard({ currentUsername }: { currentUsername: string }) {
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
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Painel de administração</h1>
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
      </nav>

      <section className={styles.panel}>
        {tab === 'users' ? (
          <UsersPanel currentUsername={currentUsername} />
        ) : (
          <ChannelsPanel />
        )}
      </section>
    </div>
  );
}
