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

export interface DbSound {
  id: number;
  name: string;
  filename: string;
  mime: string;
  size: number;
  uploaded_by: number | null;
  created_at: number;
  // Corte NAO destrutivo (ver migrateSoundTrimColumns): segundos a pular no
  // comeco e segundo em que o som para. O arquivo no disco continua inteiro;
  // quem aplica o corte e o `playSfx` na hora de tocar. `trim_end` NULL = ate
  // o fim.
  trim_start: number;
  trim_end: number | null;
}

export interface DbMessageAttachment {
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_kind: string | null;
  attachment_size: number | null;
}

export interface DbMessage extends DbMessageAttachment {
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
  // Soundboard. Biblioteca COMPARTILHADA de propósito (é o pedido): o que
  // alguém sobe fica disponível pra todo mundo tocar, não é coleção por
  // pessoa. `uploaded_by` existe só pra saber quem pode apagar (o autor ou um
  // admin, mesma regra de apagar mensagem) e vira NULL se a conta sumir — o
  // som permanece, porque já é do grupo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
  `);

  migrateAvatarColumn(db);
  migrateSoundTrimColumns(db);
  migrateChannelTypeColumn(db);
  migrateAttachmentColumns(db);

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
 * Migração aditiva (corte de áudio na soundboard): `trim_start` e `trim_end`
 * em `sounds`.
 *
 * Guardar os limites em vez de reescrever o arquivo: cortar de verdade exigiria
 * decodificar e reencodar no servidor (ffmpeg na imagem) e tornaria o ajuste
 * irreversível. Dois números resolvem — o `playSfx` já sabe começar num offset
 * e parar numa duração, e dá pra afrouxar o corte depois. Som já existente
 * pega `trim_start = 0` e `trim_end = NULL` (tudo), então nada muda pra quem
 * já tinha biblioteca.
 */
function migrateSoundTrimColumns(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(sounds)').all() as unknown as Array<{
    name: string;
  }>;
  const existing = new Set(columns.map((c) => c.name));
  if (!existing.has('trim_start')) {
    db.exec('ALTER TABLE sounds ADD COLUMN trim_start REAL NOT NULL DEFAULT 0;');
    console.log('[migrate] coluna sounds.trim_start adicionada.');
  }
  if (!existing.has('trim_end')) {
    db.exec('ALTER TABLE sounds ADD COLUMN trim_end REAL;');
    console.log('[migrate] coluna sounds.trim_end adicionada.');
  }
}

/**
 * Migração aditiva (anexos no chat): cinco colunas em `messages`, todas
 * anuláveis — mensagem sem anexo continua sendo o caso normal.
 *
 * Colunas em vez de tabela `attachments` própria: o requisito é UM anexo por
 * mensagem (2-5 amigos, não é um Drive), e uma tabela extra só acrescentaria um
 * JOIN em toda listagem de histórico. Se um dia virar "vários anexos", a tabela
 * entra sem quebrar nada do que está aqui.
 *
 * `attachment_path` é o nome do arquivo no disco (UUID + extensão que NÓS
 * derivamos dos magic bytes); `attachment_name` é o nome original, só pra
 * exibir e pro download.
 */
function migrateAttachmentColumns(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(messages)').all() as unknown as Array<{
    name: string;
  }>;
  const existing = new Set(columns.map((c) => c.name));
  const wanted: Array<[string, string]> = [
    ['attachment_path', 'TEXT'],
    ['attachment_name', 'TEXT'],
    ['attachment_mime', 'TEXT'],
    ['attachment_kind', 'TEXT'],
    ['attachment_size', 'INTEGER'],
  ];
  for (const [name, type] of wanted) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type};`);
      console.log(`[migrate] coluna messages.${name} adicionada.`);
    }
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
