// Limites de upload, num módulo SEM dependência de Node.
//
// Existe separado de lib/attachments.ts e lib/sounds.ts porque aqueles dois
// importam `node:fs` — e o cliente precisa dos mesmos números pra avisar
// "arquivo grande demais" antes de gastar a subida de alguém. Importar os
// módulos de servidor num componente quebraria o build.
//
// A validação que VALE continua sendo a do servidor; isto aqui é só cortesia
// com quem está enviando.

/**
 * 95 MiB, e não os 100 MB "redondos".
 *
 * MOTIVO, QUE NÃO É ARBITRÁRIO: todo o tráfego HTTP do Concord passa por
 * Cloudflare Tunnel (ver HANDOFF seção 1), e o plano Free/Pro do Cloudflare
 * recusa requisições com corpo acima de 100 MB. Um anexo exatamente no limite,
 * somado ao overhead do envelope HTTP, falharia NO PROXY — antes de chegar na
 * app, com um erro impossível de tratar direito no cliente. 95 MiB deixa folga
 * e ainda cabe um clipe de 2 min em 1080p.
 */
export const MAX_ATTACHMENT_BYTES = 95 * 1024 * 1024;

/**
 * 1 MiB. Um som de soundboard é um efeito de 1–3 segundos; muito mais que isso
 * é música, e música é outro problema (cada cliente tocaria no seu tempo — ver
 * lib/soundboardEvents.ts). Também segura o crescimento do volume: mesmo com a
 * biblioteca aberta pra todo mundo, 100 sons cabem em 100 MB.
 */
export const MAX_SOUND_BYTES = 1024 * 1024;

/** Quanto tempo o nome de um som pode ter na tela. */
export const MAX_SOUND_NAME_LENGTH = 40;
