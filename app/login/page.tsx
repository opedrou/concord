import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session';
import { LoginForm } from './LoginForm';
import { ConcordMark } from '@/lib/icons';
import styles from '../../styles/Login.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Já logado? Manda direto pra home em vez de mostrar o form de novo.
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const uid = await verifySession(token);
  if (uid !== null) {
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
          <p className={styles.brandTagline}>Seu grupo, num cantinho só.</p>
        </div>
        <div className={styles.card}>
          <LoginForm />
        </div>
        <p className={styles.loginFooter}>
          Self-hosted e seu — roda no seu próprio servidor.
          <br />
          Não há cadastro: quem cria as contas é o dono.
        </p>
      </div>
    </main>
  );
}
