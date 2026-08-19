// Copia os AudioWorklets e os binarios WASM do @sapphi-red/web-noise-suppressor
// pra `public/noise-suppressor/`, de onde o navegador os carrega em runtime.
//
// Por que copiar em vez de importar:
//
//  - `ctx.audioWorklet.addModule(url)` precisa de uma URL de verdade, servida
//    pelo mesmo origin. O arquivo do worklet NAO pode passar pelo bundler do
//    Next: ele roda num escopo separado (AudioWorkletGlobalScope), sem `window`
//    nem `document`, e o que o webpack injeta ali quebraria na hora.
//  - o `.wasm` e buscado por `fetch` na main thread (`loadRnnoise`/`loadGtcrn`)
//    e entregue ao worklet como ArrayBuffer via `processorOptions` — de novo,
//    precisa de URL servida, nao de import.
//
// Os `dist/*/workletProcessor.js` publicados foram conferidos e sao bundles
// self-contained (zero `import` de especificador bare), entao copiar o arquivo
// cru basta — nao ha passo de bundling aqui.
//
// Roda no `predev` e no `prebuild` (ver package.json). O Dockerfile ja faz
// `COPY --from=builder /app/public ./public` e o `pnpm build` dispara o
// `prebuild`, entao a imagem de producao recebe esses arquivos sem mudanca
// nenhuma no Dockerfile.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// Caminho direto em node_modules em vez de `require.resolve`: o `exports` do
// pacote nao expoe `./package.json`, entao nao da pra descobrir a raiz dele
// pelo resolver do Node.
const pkgDist = join(appDir, 'node_modules', '@sapphi-red', 'web-noise-suppressor', 'dist');
const outDir = join(appDir, 'public', 'noise-suppressor');

// Nomes de destino achatados: `rnnoiseWorklet.js` em vez de
// `rnnoise/workletProcessor.js`, batendo com os subpaths que o proprio pacote
// exporta (`@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js`) e mantendo as
// URLs em `lib/denoise.ts` curtas.
const files = [
  ['rnnoise/workletProcessor.js', 'rnnoiseWorklet.js'],
  ['rnnoise.wasm', 'rnnoise.wasm'],
  ['rnnoise_simd.wasm', 'rnnoise_simd.wasm'],
  ['gtcrn/workletProcessor.js', 'gtcrnWorklet.js'],
  ['gtcrn.wasm', 'gtcrn.wasm'],
];

await mkdir(outDir, { recursive: true });

for (const [from, to] of files) {
  const src = join(pkgDist, from);
  try {
    await stat(src);
  } catch {
    // Falhar alto e de proposito: se o pacote mudou de layout numa atualizacao,
    // um build silenciosamente sem os worklets viraria "reducao de ruido nao
    // funciona em producao" — bem mais caro de descobrir do que um build
    // quebrado aqui.
    throw new Error(
      `[copy-noise-suppressor] arquivo esperado nao existe: ${src}\n` +
        'O layout do @sapphi-red/web-noise-suppressor mudou? Confira o campo ' +
        '"exports" do package.json dele e ajuste a lista acima.',
    );
  }
  await copyFile(src, join(outDir, to));
}

console.log(`[copy-noise-suppressor] ${files.length} arquivos -> public/noise-suppressor/`);
