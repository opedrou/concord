// Cor dominante de uma imagem, calculada NO NAVEGADOR com <canvas> — a mesma
// escolha do lib/resizeImageClientSide.ts e pelo mesmo motivo: o servidor não
// pode ganhar dependência nativa de imagem (sharp etc.) sem quebrar o build
// Alpine/standalone. O resultado (`#rrggbb`) viaja junto do upload e é
// guardado em `users.avatar_color` — o cálculo acontece uma vez na vida da
// foto, nunca por render de tile.
//
// DOMINANTE, não média: média de avatar colorido dá cinza-barro (o vermelho de
// um lado com o verde do outro se cancelam). Um histograma com quantização
// grosseira resolve — agrupa cores parecidas no mesmo balde, o balde mais
// cheio ganha. Nada de k-means: é um avatar de 512px, não um estudo de
// paleta.

/** Baldes de 32 níveis por canal => 8x8x8 = 512 baldes. Junta tons vizinhos
 * (um degradê de pele vira um balde só) sem misturar cores diferentes. */
const BUCKET_SIZE = 32;
/** A imagem é reduzida a no máximo isto antes de contar pixels: o resultado
 * praticamente não muda e a conta fica instantânea. */
const SAMPLE_MAX_DIMENSION = 64;
/** Abaixo disso o pixel é transparente demais pra contar como cor. */
const MIN_ALPHA = 128;
/** Fora desta faixa de luminância o pixel é quase-branco/quase-preto — quase
 * sempre o fundo da foto, não a cor da pessoa. Entra num histograma separado,
 * usado só se não sobrar mais nada. */
const MIN_LUMA = 24;
const MAX_LUMA = 232;

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Cor dominante da imagem contida no blob, em `#rrggbb` minúsculo.
 * `null` quando o navegador não conseguiu decodificar/desenhar a imagem — o
 * chamador simplesmente segue sem cor (o tile cai no `--accent`).
 */
export async function dominantColorFromBlob(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, SAMPLE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    return dominantColorFromPixels(ctx.getImageData(0, 0, width, height).data);
  } catch {
    // Formato exótico, canvas "tainted", navegador sem createImageBitmap —
    // nunca vale quebrar o upload (ou a tela) por causa de uma cor de fundo.
    return null;
  }
}

/**
 * Mesma coisa, mas a partir de uma URL do próprio app (ex.: `/api/avatars/7`).
 * Usada só no backfill das fotos que já existiam antes desta coluna.
 */
export async function dominantColorFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await dominantColorFromBlob(await res.blob());
  } catch {
    return null;
  }
}

function dominantColorFromPixels(data: Uint8ClampedArray): string | null {
  const main = new Map<number, Bucket>();
  const fallback = new Map<number, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < MIN_ALPHA) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Luminância perceptual (Rec. 601) — barata e boa o bastante pra separar
    // "fundo branco do estúdio" de "camisa vermelha".
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const target = luma < MIN_LUMA || luma > MAX_LUMA ? fallback : main;
    const key =
      ((r / BUCKET_SIZE) | 0) * 64 + ((g / BUCKET_SIZE) | 0) * 8 + ((b / BUCKET_SIZE) | 0);
    const bucket = target.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      target.set(key, { count: 1, r, g, b });
    }
  }

  // Foto inteira quase-branca/quase-preta (print de documento, silhueta): aí o
  // fundo É a cor da foto, e usar o histograma descartado é melhor que
  // devolver nada.
  const winner = biggest(main) ?? biggest(fallback);
  if (!winner) return null;
  // Média DENTRO do balde vencedor: o balde é grosseiro (32 níveis), a média
  // dos pixels que caíram nele devolve o tom exato sem risco de cinza — todos
  // já são a mesma cor.
  return toHex(winner.r / winner.count, winner.g / winner.count, winner.b / winner.count);
}

function biggest(buckets: Map<number, Bucket>): Bucket | null {
  let best: Bucket | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return best;
}

function toHex(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
