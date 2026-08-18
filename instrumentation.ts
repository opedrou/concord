// Hook de boot do Next.js (roda uma vez quando o servidor sobe, tanto em
// `next dev` quanto em `node server.js`). Usado para:
//  1. Falhar alto se SESSION_SECRET faltar em produção, em vez de deixar a
//     app subir com um segredo default inseguro.
//  2. Garantir o schema do SQLite (idempotente).
//  3. Semear o primeiro admin a partir de ADMIN_USERNAME/ADMIN_PASSWORD.
//
// Só faz sentido no runtime Node (o Edge não tem acesso a node:sqlite nem
// node:crypto), daí o guard por NEXT_RUNTIME.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getSessionSecret } = await import('./lib/session');
    getSessionSecret(); // lança erro se SESSION_SECRET faltar em produção

    const { getDb, seedInitialAdmin } = await import('./lib/db');
    getDb();
    seedInitialAdmin();
  }
}
