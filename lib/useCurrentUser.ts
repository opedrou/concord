'use client';

import * as React from 'react';
import { fetchCurrentUser, type CurrentUser } from '@/lib/api-client';

/**
 * Busca o usuario logado (sessao via cookie, criada pela onda 1) uma unica vez.
 *
 * ATENCAO — CONTRATO ASSUMIDO: se GET /api/auth/me responder 401, assumimos que existe
 * uma rota /login (criada pela onda 1) para onde redirecionar. Se o path real for
 * outro, so precisa ajustar a constante LOGIN_PATH abaixo.
 */
const LOGIN_PATH = '/login';

export interface UseCurrentUserResult {
  user: CurrentUser | null;
  loading: boolean;
  error: Error | null;
}

export function useCurrentUser(options?: { redirectToLogin?: boolean }): UseCurrentUserResult {
  const redirectToLogin = options?.redirectToLogin ?? true;
  const [user, setUser] = React.useState<CurrentUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        if (u === null && redirectToLogin && typeof window !== 'undefined') {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `${LOGIN_PATH}?next=${next}`;
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [redirectToLogin]);

  return { user, loading, error };
}
