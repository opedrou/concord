// Protege páginas contra acesso sem sessão. Roda no runtime Edge (default do
// Next), por isso usa só lib/session.ts (Web Crypto), nunca node:sqlite ou
// node:crypto.
//
// Isso é só a camada de UX (redireciona pra /login em vez de mostrar uma
// tela quebrada). A autorização de verdade é checada em cada rota de API
// (ver lib/api-auth.ts) — nunca confiar só nisso aqui.
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session';

// Rotas de API fazem sua própria checagem de auth (com acesso ao banco, no
// runtime Node) e ficam de fora do middleware. /login e assets estáticos
// também.
//
// `noise-suppressor` são os worklets e binários WASM da redução de ruído
// (public/, copiados por scripts/copy-noise-suppressor.mjs). Ficam de fora por
// dois motivos: rodar verificação de sessão a cada fetch de um .wasm de 200KB
// não serve pra nada, e se a sessão expirasse no meio de uma chamada o
// `audioWorklet.addModule()` receberia o HTML da tela de login em vez do
// script — falha confusa de diagnosticar. São assets públicos, sem nada
// sensível.
export const config = {
  matcher: ['/((?!api|login|_next|images|fonts|noise-suppressor|favicon.ico).*)'],
};

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const uid = await verifySession(token);

  if (uid === null) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
