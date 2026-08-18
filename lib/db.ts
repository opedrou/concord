// Camada de persistência em SQLite.
//
// Escolha de lib: `node:sqlite` (nativo do Node >= 22.5, ainda experimental).
// Critério decisivo foi o `docker build` em node:22-alpine — qualquer binding
// nativo (better-sqlite3) exige toolchain de build (python3/make/g++) na
// imagem e cuidado extra pro `.node` sobreviver ao tracing do
// `output: 'standalone'`. `node:sqlite` é parte do runtime: zero dependência
// nova, zero binário pra copiar, funciona igual em musl (Alpine) e glibc.
// A contrapartida é o aviso de "experimental feature" no stderr — inofensivo,
// e a API (prepare/run/get/all) já é estável o bastante pro nosso uso.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
const DATABASE_PATH = process.env.DATABASE_PATH ?? path.join(DATA_DIR, 'app.db');

// Guardamos a conexão em `globalThis` para sobreviver ao Fast Refresh do
// `next dev` (que re-executa o módulo a cada mudança) sem reabrir o arquivo
// várias vezes. Em produção (`node server.js`) é só um processo, então isso
// vira um singleton comum.
declare global {
  // eslint-disable-next-line no-var
  var __appDb: DatabaseSync | undefined;
}

export interface DbUser {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: number;
  // Nome do arquivo (nao o caminho completo) do avatar em $DATA_DIR/avatars,
  // ou null quando o usuario nao fez upload de foto (cai no avatar gerado
  // por iniciais no cliente). Coluna adicionada pela ONDA C — ver
  // migrateAvatarColumn().
  avatar_path: string | null;
}

// Tipo de canal. `voice` é o que já existia (sala do LiveKit); `text` é novo
// (canal `#` estilo Discord, com histórico de mensagens neste mesmo banco).
export type ChannelType = 'voice' | 'text';

export interface DbChannel {
  id: number;
  name: string;
  slug: string;
  position: number;
  created_at: number;
  // Coluna adicionada pela ONDA A — ver migrateChannelTypeColumn(). Todo
  // canal criado antes dessa migração recebe 'voice' automaticamente (era o
  // único tipo que existia), então nada muda pra quem já tinha canais.
  type: ChannelType;
}

export interface DbMessage {
  id: number;
  channel_id: number;
  user_id: number | null;
  content: string;
  created_at: number;
}

/** Abre (ou reaproveita) a conexão com o banco e garante o schema. */
export function getDb(): DatabaseSync {
  if (globalThis.__appDb) {
    return globalThis.__appDb;
  }

  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

  const db = new DatabaseSync(DATABASE_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // CREATE TABLE IF NOT EXISTS: inicialização idempotente, pode rodar em
  // todo boot do container sem risco de apagar dados existentes no volume.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  // Mensagens de canal de texto. `user_id` pode virar NULL se a conta do
  // autor for apagada depois (ON DELETE SET NULL) — a mensagem em si
  // permanece no histórico, só perde a referência de autoria (mostrada como
  // "usuário removido" no cliente). Apagar o canal apaga as mensagens junto
  // (ON DELETE CASCADE) — não faz sentido guardar mensagem órfã de um canal
  // que não existe mais.
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // Índice composto (channel_id, id): sustenta tanto "últimas mensagens do
  // canal" quanto a paginação por cursor (WHERE channel_id = ? AND id < ?
  // ORDER BY id DESC LIMIT ?) sem varrer a tabela inteira.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages (channel_id, id);`);

  migrateAvatarColumn(db);
  migrateChannelTypeColumn(db);

  globalThis.__appDb = db;
  return db;
}

/**
 * Migração aditiva (ONDA C): adiciona a coluna `avatar_path` em `users` se
 * ainda não existir. `CREATE TABLE IF NOT EXISTS` não cobre alterações em
 * tabela já existente — checamos via PRAGMA table_info antes de rodar o
 * ALTER TABLE, porque node:sqlite não aceita "ADD COLUMN IF NOT EXISTS" e
 * rodar o ALTER de novo num banco que já tem a coluna quebraria o boot.
 * Não destrutivo: nunca dropa nem reescreve dado existente.
 */
function migrateAvatarColumn(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(users)').all() as unknown as Array<{
    name: string;
  }>;
  const hasAvatarColumn = columns.some((c) => c.name === 'avatar_path');
  if (!hasAvatarColumn) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_path TEXT;');
    console.log('[migrate] coluna users.avatar_path adicionada.');
  }
}

/**
 * Migração aditiva (ONDA A — canais de texto): adiciona a coluna `type` em
 * `channels` se ainda não existir, com `DEFAULT 'voice'`. SQLite aplica o
 * default a toda linha já existente na hora do ALTER TABLE — então qualquer
 * canal cadastrado antes desse deploy (só existia canal de voz) continua
 * funcionando como canal de voz sem nenhuma ação manual. Mesmo cuidado da
 * migração acima: PRAGMA table_info antes do ALTER, porque rodar o ALTER de
 * novo num banco que já tem a coluna quebraria o boot. Não destrutivo.
 */
function migrateChannelTypeColumn(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(channels)').all() as unknown as Array<{
    name: string;
  }>;
  const hasTypeColumn = columns.some((c) => c.name === 'type');
  if (!hasTypeColumn) {
    db.exec("ALTER TABLE channels ADD COLUMN type TEXT NOT NULL DEFAULT 'voice';");
    console.log("[migrate] coluna channels.type adicionada (canais existentes viraram 'voice').");
  }
}

/**
 * Cria o primeiro admin a partir de ADMIN_USERNAME/ADMIN_PASSWORD, mas só se
 * ainda não existir nenhum admin no banco. Chamado uma vez no boot
 * (instrumentation.ts). Idempotente: rodar de novo não duplica nem reseta
 * senha de admins já existentes.
 */
export function seedInitialAdmin(): void {
  const db = getDb();
  const existingAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
  if (existingAdmin) {
    return;
  }

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      '[seed] Nenhum admin no banco e ADMIN_USERNAME/ADMIN_PASSWORD não definidos — ' +
        'ninguém vai conseguir logar. Defina essas variáveis e reinicie o container.',
    );
    return;
  }

  const passwordHash = hashPassword(password);
  // Se por acaso já existir um usuário comum com esse username, só promove;
  // senão cria do zero. Nunca sobrescreve a senha de um usuário existente.
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
    | { id: number }
    | undefined;
  if (existingUser) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existingUser.id);
    console.log(`[seed] usuário "${username}" promovido a admin.`);
  } else {
    db.prepare(
      'INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)',
    ).run(username, passwordHash, Date.now());
    console.log(`[seed] admin "${username}" criado.`);
  }
}
