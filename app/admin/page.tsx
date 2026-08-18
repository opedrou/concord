// Página de administração — só admins podem ver.
//
// O middleware (raiz do projeto) já garante que só chega aqui quem tem uma
// sessão válida (senão redireciona pra /login). Falta só checar `is_admin`,
// igual o app/login/page.tsx faz pra sessão. Essa checagem aqui é só UX —
// evita o flash da tela pra quem não é admin; a barreira que vale de
// verdade é o `requireAdmin` em cada rota de app/api/users e
// app/api/channels (ONDA 1).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session';
import { getDb } from '@/lib/db';
import { AdminDashboard } from './AdminDashboard';
import styles from '../../styles/Admin.module.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const uid = await verifySession(token);
  if (uid === null) {
    redirect('/login');
  }

  const db = getDb();
  const row = db.prepare('SELECT username, is_admin FROM users WHERE id = ?').get(uid) as
    | { username: string; is_admin: number }
    | undefined;

  // Conta pode ter sido apagada entre a assinatura da sessão e agora, ou não
  // ser admin — nos dois casos, não mostra o painel.
  if (!row || row.is_admin !== 1) {
    redirect('/');
  }

  return (
    <main className={styles.main} data-lk-theme="default">
      <AdminDashboard currentUsername={row.username} />
    </main>
  );
}
