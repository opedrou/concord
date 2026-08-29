/** @type {import('next').NextConfig} */
const nextConfig = {
  // imagem Docker enxuta (o upstream e feito pra Vercel)
  output: 'standalone',
  reactStrictMode: false,
  productionBrowserSourceMaps: true,
  images: {
    formats: ['image/webp'],
  },
  webpack: (config, { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack }) => {
    // Important: return the modified config
    config.module.rules.push({
      test: /\.mjs$/,
      enforce: 'pre',
      use: ['source-map-loader'],
    });

    return config;
  },
  headers: async () => {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          // NAO acrescentar Cross-Origin-Embedder-Policy aqui. Ele existia
          // (com valor `credentialless`), veio do template do LiveKit e nunca
          // teve comentario explicando por que. Foi removido de proposito:
          //
          // COEP + COOP colocam a pagina em isolamento cross-origin, e o unico
          // beneficio disso e destravar o SharedArrayBuffer. NADA neste
          // projeto usa SharedArrayBuffer — a unica mencao no codigo e um
          // comentario de tipagem do TypeScript em lib/micProcessor.ts, e o
          // E2EE do livekit-client (que so liga com passphrase no hash da URL)
          // usa insertable streams, nao memoria compartilhada.
          //
          // O preco, esse sim, era real: com COEP ligado o Chrome bloqueia
          // qualquer recurso cross-origin que nao consinta explicitamente, e o
          // YouTube nao consente. O iframe do player vinha como pagina de erro
          // e a IFrame API nunca chegava ao onReady — medido no navegador
          // (spike W0 do PLANO-2.md), com o embed voltando a funcionar assim
          // que o header saiu.
          //
          // Ou seja: pagava o custo sem entregar o beneficio. Se um dia o E2EE
          // for ligado pra valer, ou algo passar a precisar de
          // SharedArrayBuffer, reconferir — o YouTube por iframe e o
          // isolamento cross-origin nao convivem.
        ],
      },
    ];
  },
};

module.exports = nextConfig;
