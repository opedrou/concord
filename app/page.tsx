'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChannelSidebar } from '@/lib/ChannelSidebar';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { logout } from '@/lib/api-client';
import { ConcordMark } from '@/lib/icons';
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
        {/* A marca desenhada no lugar do wordmark em SVG: no projeto de design
            a home e a marca grande + uma saudacao com o SEU nome, nao um
            letreiro do produto. */}
        <ConcordMark size={92} className={styles.welcomeMark} />
        <h2 className={styles.welcomeTitle}>Bem-vindo de volta, {user?.username ?? 'por aqui'}.</h2>
        <p className={styles.welcomeHint}>
          Escolha um canal de voz ao lado para entrar — você vê quem já está lá antes de clicar. Ou
          abra um canal de texto para colocar a conversa em dia.
        </p>
      </main>
    </div>
  );
}
