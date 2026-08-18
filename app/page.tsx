'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChannelSidebar } from '@/lib/ChannelSidebar';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { logout } from '@/lib/api-client';
import styles from '../styles/Home.module.css';

// A home deixou de ser a tela de "criar/entrar em sala por link" do upstream —
// com canais permanentes (login + presenca), o fluxo vira uma sidebar de canais
// de voz estilo Discord. Quem quiser conectar num servidor LiveKit arbitrario
// ainda tem a rota /custom (preservada, so nao fica mais linkada na home).
export default function Page() {
  const { user, loading } = useCurrentUser({ redirectToLogin: true });
  const router = useRouter();

  const handleLogout = React.useCallback(async () => {
    try {
      await logout();
    } finally {
      router.push('/login');
    }
  }, [router]);

  if (loading) {
    return (
      <main className={styles.main} data-lk-theme="default">
        <p>Carregando...</p>
      </main>
    );
  }

  return (
    <div className={styles.appShell} data-lk-theme="default">
      <ChannelSidebar user={user} onLogout={handleLogout} />
      <main className={styles.welcomePane}>
        <img src="/images/livekit-meet-home.svg" alt="Concordo" width="240" height="30" />
        <h2>Escolha um canal de voz ao lado para entrar.</h2>
        <p className={styles.welcomeHint}>
          Voce ve quem esta em cada canal antes mesmo de entrar — basta clicar no canal.
        </p>
      </main>
    </div>
  );
}
