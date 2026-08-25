'use client';

import * as React from 'react';
import { backfillMyAvatarColor, fetchCurrentUser, type CurrentUser } from '@/lib/api-client';
import { dominantColorFromUrl } from '@/lib/dominantColor';

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

/**
 * BACKFILL da cor do avatar (U1). A cor dominante e calculada no navegador,
 * entao o servidor nao consegue preencher sozinho as fotos que ja existiam
 * antes da coluna `users.avatar_color` — quem faz isso e o cliente da PROPRIA
 * pessoa, na primeira vez que ela abre o app depois do deploy. E o unico
 * caminho que backfilla de verdade sem afrouxar a regra de que ninguem mexe no
 * avatar de ninguem: cada um preenche o seu.
 *
 * Uma vez por carregamento de pagina (varios componentes usam este hook), e
 * best-effort: se a imagem nao decodificar ou o PATCH falhar, a pessoa
 * simplesmente continua com o `--accent` ate a proxima visita.
 */
let avatarColorBackfillTried = false;

function backfillAvatarColor(user: CurrentUser): void {
  if (avatarColorBackfillTried || !user.avatarUrl || user.avatarColor) {
    return;
  }
  avatarColorBackfillTried = true;
  void dominantColorFromUrl(user.avatarUrl)
    .then((color) => (color ? backfillMyAvatarColor(color) : undefined))
    .catch(() => {
      // Cosmetico: nunca vale barulho na tela por causa de uma cor de fundo.
    });
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
        if (u) {
          backfillAvatarColor(u);
        }
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
