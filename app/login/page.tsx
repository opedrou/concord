import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session';
import { LoginForm } from './LoginForm';
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
      <div className={styles.card}>
        <h1 className={styles.title}>Entrar</h1>
        <LoginForm />
      </div>
    </main>
  );
}
