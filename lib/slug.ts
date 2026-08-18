// Gera o `slug` de um canal a partir do nome (usado como roomName do
// LiveKit). Minúsculo, sem acento, só [a-z0-9-].
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove marcas de acento (após normalize NFD)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
