// Extrai o id de um vídeo do YouTube do que a pessoa colar. Puro e testável —
// é a única parte do W4 que dá pra testar sem navegador.
//
// O protocolo do W1 trata `src` como opaco, então quem normaliza é aqui: a
// sessão trafega sempre o id de 11 caracteres, nunca a URL crua. Assim duas
// pessoas colando a mesma live por caminhos diferentes (youtu.be e
// youtube.com/live) abrem a MESMA sessão, em vez de duas.

/** Ids do YouTube têm 11 caracteres de um alfabeto base64-url. */
const VIDEO_ID = /^[\w-]{11}$/;

/** Caminhos que carregam o id direto no path, não em `?v=`. */
const PATH_PREFIXES = ['/live/', '/embed/', '/shorts/', '/v/'];

/**
 * @returns o id de 11 caracteres, ou `null` se não der pra reconhecer.
 */
export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // Coube colar só o id.
  if (VIDEO_ID.test(trimmed)) {
    return trimmed;
  }

  // `new URL` exige esquema; quem cola costuma omitir.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return VIDEO_ID.test(id) ? id : null;
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') {
    return null;
  }

  const fromQuery = url.searchParams.get('v');
  if (fromQuery && VIDEO_ID.test(fromQuery)) {
    return fromQuery;
  }

  for (const prefix of PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      const id = url.pathname.slice(prefix.length).split('/')[0];
      return VIDEO_ID.test(id) ? id : null;
    }
  }

  return null;
}

/**
 * Onde o vídeo começa, em ms, se a URL trouxer `t=` ou `start=`. O YouTube
 * aceita `90`, `90s`, `1m30s` e `1h2m3s`.
 */
export function parseYouTubeStartMs(input: string): number {
  const match = /[?&](?:t|start)=([^&#]+)/.exec(input);
  if (!match) {
    return 0;
  }
  const raw = decodeURIComponent(match[1]);
  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1000;
  }
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!parts || (!parts[1] && !parts[2] && !parts[3])) {
    return 0;
  }
  const hours = Number(parts[1] ?? 0);
  const minutes = Number(parts[2] ?? 0);
  const seconds = Number(parts[3] ?? 0);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}
