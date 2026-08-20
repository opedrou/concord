// Redimensiona/comprime a foto de perfil no navegador via <canvas> antes do
// upload — evitamos de propósito qualquer dependência nativa de imagem
// (sharp etc.) no servidor porque isso quebraria o build Alpine/standalone
// (ver Dockerfile/HANDOFF.md). O servidor ainda valida o arquivo final por
// magic bytes independente disso ter rodado ou não.
/** Foto de perfil: nunca é exibida grande, 512px sobra. */
const AVATAR_MAX_DIMENSION = 512;
/** Anexo de chat: alguém vai querer LER o print. 1600px é o que a maioria das
 * telas mostra em tamanho cheio, e ainda corta bastante de uma foto de celular
 * de 4000px. */
export const ATTACHMENT_MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

/**
 * Recebe o File escolhido no <input type="file"> e devolve um Blob JPEG
 * redimensionado. Se por algum motivo o canvas falhar (formato exótico,
 * navegador sem suporte), devolve o arquivo original sem mexer — o upload
 * ainda funciona, só sem a otimização.
 */
export async function resizeImageClientSide(
  file: File,
  maxDimension: number = AVATAR_MAX_DIMENSION,
): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
