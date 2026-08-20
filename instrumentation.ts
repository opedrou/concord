// Hook de boot do Next.js (roda uma vez quando o servidor sobe, tanto em
// `next dev` quanto em `node server.js`). Usado para:
//  1. Falhar alto se SESSION_SECRET faltar em produção, em vez de deixar a
//     app subir com um segredo default inseguro.
//  2. Garantir o schema do SQLite (idempotente).
//  3. Semear o primeiro admin a partir de ADMIN_USERNAME/ADMIN_PASSWORD.
//  4. Garantir que $DATA_DIR/avatars existe (idempotente) — onde ficam as
//     fotos de perfil enviadas pelos usuários (ONDA C).
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

    const { ensureAvatarsDir } = await import('./lib/avatars');
    ensureAvatarsDir();

    // Anexos do chat e sons da soundboard: mesmas garantias que os avatares
    // (diretorio existe, dentro do volume persistente).
    const { ensureAttachmentsDir, cleanupOrphanAttachments } = await import('./lib/attachments');
    ensureAttachmentsDir();

    const { ensureSoundsDir } = await import('./lib/sounds');
    ensureSoundsDir();

    // Arquivo enviado cujo POST de mensagem nunca chegou fica orfao no volume.
    // Limpar no boot e o suficiente — ver comentario em cleanupOrphanAttachments.
    try {
      const rows = getDb()
        .prepare('SELECT attachment_path FROM messages WHERE attachment_path IS NOT NULL')
        .all() as unknown as Array<{ attachment_path: string }>;
      const removed = cleanupOrphanAttachments(new Set(rows.map((r) => r.attachment_path)));
      if (removed > 0) {
        console.log(`[boot] ${removed} anexo(s) orfao(s) removido(s).`);
      }
    } catch (error) {
      // Limpeza e manutencao, nunca pode impedir o boot.
      console.error('[boot] falha ao limpar anexos orfaos:', error);
    }
  }
}
