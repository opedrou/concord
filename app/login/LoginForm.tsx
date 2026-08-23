'use client';

import * as React from 'react';
import styles from '../../styles/Login.module.css';

export function LoginForm() {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        // Mesma mensagem pra usuário inexistente ou senha errada — não dá
        // pra usar o erro pra descobrir se uma conta existe.
        setError('Usuário ou senha inválidos.');
        setSubmitting(false);
        return;
      }
      // Reforço: pede pro navegador guardar a credencial via Credential
      // Management API, quando suportada (Chrome/Edge; Firefox e Safari não
      // implementam). Best-effort — falha em silêncio se indisponível.
      try {
        const PasswordCredentialCtor = (window as unknown as { PasswordCredential?: any })
          .PasswordCredential;
        if (PasswordCredentialCtor && navigator.credentials) {
          const cred = new PasswordCredentialCtor({ id: username, password, name: username });
          await navigator.credentials.store(cred);
        }
      } catch {
        // Sem suporte ou usuário recusou — segue o fluxo normal.
      }
      // Navegação de verdade (não router.push do Next) — é o gatilho que os
      // gerenciadores de senha do navegador esperam pra oferecer "salvar
      // senha". Um submit via fetch seguido de troca de estado client-side
      // não é reconhecido como um login bem-sucedido pelo heurístico deles.
      window.location.assign('/');
    } catch {
      setError('Não foi possível conectar. Tente de novo.');
      setSubmitting(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className={styles.field}>
        <label htmlFor="username">Usuário</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <button className={`lk-button ${styles.submit}`} type="submit" disabled={submitting}>
        {submitting ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
