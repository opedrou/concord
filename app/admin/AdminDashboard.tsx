'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiErrorMessage, logout } from '@/lib/api-client';
import { UsersPanel } from './UsersPanel';
import { ChannelsPanel } from './ChannelsPanel';
import { IntegrationsPanel } from './IntegrationsPanel';
import { ShieldIcon } from '@/lib/icons';
import styles from '../../styles/Admin.module.css';

type Tab = 'users' | 'channels' | 'integrations';

const TABS: { id: Tab; label: string }[] = [
  { id: 'users', label: 'Pessoas' },
  { id: 'channels', label: 'Canais' },
  { id: 'integrations', label: 'Integrações' },
];

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
  // Aba na URL (?aba=canais), nao so em estado local: recarregar a pagina, dar
  // F5 depois de mexer num canal ou mandar o link pra outro admin caia sempre
  // em "Pessoas". Sobreposto (onClose presente) nao mexe na URL — a rota ali e
  // a da call, e trocar a query derrubaria o roteador no meio da chamada.
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get('aba');
  const tabLocal = React.useState<Tab>('users');
  const isTab = (v: string | null): v is Tab =>
    v === 'users' || v === 'channels' || v === 'integrations';
  const tab: Tab = onClose ? tabLocal[0] : isTab(tabFromUrl) ? tabFromUrl : 'users';
  const setTab = (next: Tab) => {
    if (onClose) {
      tabLocal[1](next);
      return;
    }
    router.replace(`?aba=${next}`, { scroll: false });
  };
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

      {/* `role="tab"` no lugar de `aria-pressed`: eram tres botoes de alternar
          que por acaso se excluiam, e o leitor de tela anunciava "botao,
          pressionado" em vez de "aba 2 de 3, selecionada". Com o padrao real,
          seta esquerda/direita e Home/End andam entre as abas e so a ativa
          fica na ordem de tabulacao (roving tabindex). */}
      <div className={styles.tabs} role="tablist" aria-label="Seções da administração">
        {TABS.map(({ id, label }, index) => (
          <button
            key={id}
            id={`aba-${id}`}
            className="lk-button"
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`painel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              let next = -1;
              if (delta !== 0) next = (index + delta + TABS.length) % TABS.length;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = TABS.length - 1;
              if (next < 0) return;
              event.preventDefault();
              setTab(TABS[next].id);
              document.getElementById(`aba-${TABS[next].id}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <section
        className={styles.panel}
        role="tabpanel"
        id={`painel-${tab}`}
        aria-labelledby={`aba-${tab}`}
      >
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
