// De onde vem o que está sendo assistido. O protocolo do W1 trata `src` como
// uma string opaca de propósito — quem dá significado a ela é aqui.
//
// Prefixo curto em vez de URL inteira: `src` viaja em toda mensagem e no
// atributo de participante, e uma URL de proxy com token seria a coisa errada
// pra colocar num campo que a sala inteira lê.

export type WatchSource = { kind: 'youtube'; id: string } | { kind: 'jellyfin'; id: string };

export function encodeWatchSource(source: WatchSource): string {
  return `${source.kind === 'youtube' ? 'yt' : 'jf'}:${source.id}`;
}

export function decodeWatchSource(src: string): WatchSource | null {
  const separator = src.indexOf(':');
  if (separator < 0) {
    return null;
  }
  const prefix = src.slice(0, separator);
  const id = src.slice(separator + 1);
  if (!id) {
    return null;
  }
  if (prefix === 'yt') {
    return { kind: 'youtube', id };
  }
  if (prefix === 'jf') {
    return { kind: 'jellyfin', id };
  }
  return null;
}
