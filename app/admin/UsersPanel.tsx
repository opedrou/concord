'use client';

import * as React from 'react';
import {
  AdminUser,
  apiErrorMessage,
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
} from '@/lib/api-client';
import { PASSWORD_MIN_LENGTH, checkPassword } from '@/lib/passwordPolicy';
import styles from '../../styles/Admin.module.css';

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('pt-BR');
  } catch {
    return '—';
  }
}

export function UsersPanel({ currentUsername }: { currentUsername: string }) {
  const [users, setUsers] = React.useState<AdminUser[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<number | null>(null);

  // Form de criação de usuário.
  const [newUsername, setNewUsername] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newIsAdmin, setNewIsAdmin] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  // Reset de senha inline — só um usuário por vez fica em edição.
  const [resettingId, setResettingId] = React.useState<number | null>(null);
  const [resetPassword, setResetPassword] = React.useState('');

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const onCreate: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setActionError(null);
    if (!newUsername.trim()) {
      setActionError('Informe um nome de usuário.');
      return;
    }
    // Feedback de UX — quem decide é o servidor (POST /api/users).
    const problem = checkPassword(newPassword, newUsername);
    if (problem) {
      setActionError(problem.reason);
      return;
    }
    setCreating(true);
    try {
      const created = await createUser({
        username: newUsername.trim(),
        password: newPassword,
        isAdmin: newIsAdmin,
      });
      setUsers((prev) =>
        [...(prev ?? []), created].sort((a, b) => a.username.localeCompare(b.username)),
      );
      setNewUsername('');
      setNewPassword('');
      setNewIsAdmin(false);
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const onToggleAdmin = async (user: AdminUser) => {
    setActionError(null);
    setBusyId(user.id);
    try {
      const updated = await updateUser(user.id, { isAdmin: !user.isAdmin });
      setUsers((prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? prev);
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const startReset = (user: AdminUser) => {
    setActionError(null);
    setResettingId(user.id);
    setResetPassword('');
  };

  const onSubmitReset = async (id: number, username: string) => {
    setActionError(null);
    const problem = checkPassword(resetPassword, username);
    if (problem) {
      setActionError(problem.reason);
      return;
    }
    setBusyId(id);
    try {
      await updateUser(id, { password: resetPassword });
      setResettingId(null);
      setResetPassword('');
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (id: number) => {
    setActionError(null);
    setBusyId(id);
    try {
      await deleteUser(id);
      setUsers((prev) => prev?.filter((u) => u.id !== id) ?? prev);
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) {
    return (
      <div className={styles.errorBox}>
        <p>{loadError}</p>
        <button className="lk-button" type="button" onClick={load}>
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <form className={styles.createForm} onSubmit={onCreate}>
        <h2 className={styles.sectionTitle}>Novo usuário</h2>
        <div className={styles.formRow}>
          <div className={styles.field}>
            <label htmlFor="new-username">Usuário</label>
            <input
              id="new-username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="new-password">Senha inicial</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
          </div>
          <div className={styles.checkboxField}>
            <input
              id="new-is-admin"
              type="checkbox"
              checked={newIsAdmin}
              onChange={(e) => setNewIsAdmin(e.target.checked)}
            />
            <label htmlFor="new-is-admin">Administrador</label>
          </div>
          <button className="lk-button" type="submit" disabled={creating}>
            {creating ? 'Criando…' : 'Criar usuário'}
          </button>
        </div>
      </form>

      {actionError && (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      )}

      <h2 className={styles.sectionTitle}>Usuários</h2>
      {users === null ? (
        <p className={styles.muted}>Carregando…</p>
      ) : users.length === 0 ? (
        <p className={styles.muted}>Nenhum usuário cadastrado.</p>
      ) : (
        <ul className={styles.list}>
          {users.map((user) => {
            const isSelf = user.username === currentUsername;
            const isResetting = resettingId === user.id;
            const isConfirmingDelete = confirmDeleteId === user.id;
            const rowBusy = busyId === user.id;

            return (
              <li key={user.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {user.username}
                    {user.isAdmin && <span className={styles.badge}>admin</span>}
                    {isSelf && <span className={styles.badgeMuted}>você</span>}
                  </span>
                  <span className={styles.rowMeta}>criado em {formatDate(user.createdAt)}</span>
                </div>

                <div className={styles.rowActions}>
                  {!isResetting ? (
                    <button className="lk-button" type="button" onClick={() => startReset(user)}>
                      Resetar senha
                    </button>
                  ) : (
                    <span className={styles.inlineForm}>
                      <input
                        type="password"
                        placeholder={`Nova senha (mín. ${PASSWORD_MIN_LENGTH})`}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        autoComplete="new-password"
                        minLength={PASSWORD_MIN_LENGTH}
                        autoFocus
                      />
                      <button
                        className="lk-button"
                        type="button"
                        disabled={rowBusy}
                        onClick={() => onSubmitReset(user.id, user.username)}
                      >
                        Salvar
                      </button>
                      <button
                        className="lk-button"
                        type="button"
                        onClick={() => setResettingId(null)}
                      >
                        Cancelar
                      </button>
                    </span>
                  )}

                  <button
                    className="lk-button"
                    type="button"
                    disabled={rowBusy || (isSelf && user.isAdmin)}
                    title={isSelf && user.isAdmin ? 'Você não pode se despromover.' : undefined}
                    onClick={() => onToggleAdmin(user)}
                  >
                    {user.isAdmin ? 'Remover admin' : 'Tornar admin'}
                  </button>

                  {!isConfirmingDelete ? (
                    <button
                      className={`lk-button ${styles.dangerButton}`}
                      type="button"
                      disabled={isSelf}
                      title={isSelf ? 'Você não pode remover a própria conta.' : undefined}
                      onClick={() => setConfirmDeleteId(user.id)}
                    >
                      Remover
                    </button>
                  ) : (
                    <span className={styles.inlineConfirm}>
                      <span>Remover {user.username}?</span>
                      <button
                        className={`lk-button ${styles.dangerButton}`}
                        type="button"
                        disabled={rowBusy}
                        onClick={() => onDelete(user.id)}
                      >
                        Confirmar
                      </button>
                      <button
                        className="lk-button"
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancelar
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
