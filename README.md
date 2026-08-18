# Concord

Concord e um app de voz e video self-hosted para grupos pequenos (estilo
Discord, so que rodando na sua propria infra). Login com usuario e senha,
canais de voz permanentes com presenca visivel, painel de admin e
compartilhamento de tela com audio.

Construido em cima do [LiveKit](https://livekit.io/) (o motor de WebRTC) e da
[LiveKit Components](https://github.com/livekit/components-js) library, sobre
Next.js — mas e um fork com identidade propria, nao e o "LiveKit Meet"
original.

## Tech Stack

- [Next.js](https://nextjs.org/) (App Router).
- [@livekit/components-react](https://github.com/livekit/components-js/) para
  os componentes de chamada.
- `node:sqlite` (builtin do Node 22) para contas, canais e sessao.

## Dev Setup

Passos para rodar localmente:

1. Rode `pnpm install` para instalar as dependencias.
2. Copie `.env.example` para `.env.local`.
3. Preencha as variaveis de ambiente que faltam em `.env.local`.
4. Rode `pnpm dev` e acesse [http://localhost:3000](http://localhost:3000).

Veja `HANDOFF.md` (na raiz do repo) para a arquitetura de deploy e as
pegadinhas ja resolvidas de infra.
