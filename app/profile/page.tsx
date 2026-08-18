import styles from '../../styles/Login.module.css';
import { ProfileClientImpl } from './ProfileClientImpl';

// Pagina de perfil: por enquanto so troca da propria foto (ONDA C). Fica
// atras do middleware como qualquer outra rota autenticada — sem sessao,
// redireciona pra /login antes de chegar aqui.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  return (
    <main className={styles.main} data-lk-theme="default">
      <div className={styles.card}>
        <h1 className={styles.title}>Seu perfil</h1>
        <ProfileClientImpl />
      </div>
    </main>
  );
}
