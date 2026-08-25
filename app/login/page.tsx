import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session';
import { getDb } from '@/lib/db';
import { LoginForm } from './LoginForm';
import { ConcordMark } from '@/lib/icons';
import styles from '../../styles/Login.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSessionLive(uid: number, sessionVersion: number): boolean {
  const row = getDb().prepare('SELECT session_version FROM users WHERE id = ?').get(uid) as
    | { session_version: number }
    | undefined;
  return row?.session_version === sessionVersion;
}

export default async function LoginPage() {
  // Já logado? Manda direto pra home em vez de mostrar o form de novo.
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(token);
  // Assinatura válida não basta: a sessão pode ter sido revogada (S5 — senha
  // trocada em outro dispositivo). Sem conferir a versão aqui, mandar essa
  // pessoa pra '/' viraria um loop, porque a home bate em /api/auth/me, leva
  // 401 e devolve ela pro /login.
  if (session && isSessionLive(session.uid, session.sessionVersion)) {
    redirect('/');
  }

  return (
    <main className={styles.main} data-lk-theme="default">
      {/* Os dois halos de acento do projeto de design, um em cada canto
          oposto. Puramente decorativos e atras de tudo. */}
      <span className={`${styles.glow} ${styles.glowTop}`} aria-hidden="true" />
      <span className={`${styles.glow} ${styles.glowBottom}`} aria-hidden="true" />
      <div className={styles.loginColumn}>
        <div className={styles.brand}>
          <ConcordMark size={76} className={styles.brandMark} />
          <h1 className={styles.brandName}>Concord</h1>
        </div>
        <div className={styles.card}>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
