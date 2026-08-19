# Concord

App de voz, vídeo e texto **self-hosted** para grupos pequenos (2–5 pessoas),
no espírito do Discord — canais permanentes, entra com um clique, e roda na sua
própria infraestrutura.

Nasceu como fork do [LiveKit Meet](https://github.com/livekit-examples/meet),
mas divergiu bastante: ganhou contas, canais permanentes, chat de texto,
administração e uma tela de chamada recomposta do zero.

---

## O que ele faz

| | |
|---|---|
| **Contas** | Login usuário + senha. O admin cria as contas — não há cadastro aberto. |
| **Canais de voz** | Permanentes. Ninguém cria sala nem manda link: entra na lista e clica. |
| **Presença** | Você vê quem está dentro de cada canal **sem precisar entrar**. |
| **Canais de texto** | Histórico persistente, entrega em tempo real por SSE. |
| **Compartilhamento de tela** | 1080p30 por padrão, com qualidade selecionável e áudio quando o navegador permite. |
| **Áudio por pessoa** | Volume individual (voz e áudio de tela separados) com curva perceptual, e "mutar só pra mim". |
| **Perfil** | Foto de perfil e troca da própria senha. |
| **Admin** | Gerenciar pessoas e canais pela UI. |

---

## Stack

- **[Next.js](https://nextjs.org/) 15** (App Router), React 18, TypeScript
- **[LiveKit](https://livekit.io/)** como motor de WebRTC —
  [`livekit-client`](https://github.com/livekit/client-sdk-js) e
  [`@livekit/components-react`](https://github.com/livekit/components-js)
- **`node:sqlite`** — o SQLite embutido do Node 22, para contas, canais e mensagens
- **`node:crypto`** — `scrypt` para senhas, HMAC para o cookie de sessão
- **pnpm** e **Docker** (`node:22-alpine`, `output: 'standalone'`)

Nenhuma dependência nativa e nenhum ORM. Isso é deliberado: `node:sqlite` não
precisa de compilação, o que evita a dor clássica de módulo nativo em Alpine e
de arquivo `.node` se perdendo no *file tracing* do build standalone.

---

## Arquitetura

Duas peças independentes:

```
navegador
   ├── app Next.js  ──────────────► só HTTP: UI, login, canais, chat, tokens
   │                                        (é este repositório)
   └── servidor LiveKit (SFU) ────► sinalização WebSocket + MÍDIA
                                    (áudio, vídeo e tela)
```

**A mídia nunca passa por este app.** Ele só entrega a interface e emite os
tokens; o áudio e o vídeo vão direto do navegador para o SFU. Na prática isso
permite hospedar os dois em máquinas diferentes — por exemplo, o app numa
máquina doméstica e o SFU numa VPS com boa banda de subida.

### Como o acesso é controlado

O ponto sensível é `GET /api/connection-details`, que emite o token do LiveKit:

- só responde a **sessão autenticada**;
- a `identity` e o `name` do participante vêm **sempre da sessão**, nunca da
  query string — do contrário qualquer pessoa se passaria por qualquer outra;
- o `roomName` precisa corresponder ao *slug* de um canal cadastrado; nome de
  sala arbitrário é recusado.

A autorização é verificada **em cada rota de API**. O middleware existe só para
redirecionar quem não está logado — ele não é a barreira de segurança.

---

## Pré-requisitos

1. **Node 22+** e **pnpm 10+** (ou só Docker).
2. **Um servidor LiveKit acessível.** Este app não sobe um SFU.
   - Para desenvolver, o jeito mais rápido é o
     [LiveKit CLI](https://github.com/livekit/livekit-cli):
     `livekit-server --dev` sobe um servidor local com credenciais de teste.
   - Para produção, veja o
     [guia de deploy do LiveKit](https://docs.livekit.io/home/self-hosting/deployment/).
     Ele precisa de TLS na sinalização (`wss://`) e das portas de mídia
     abertas — tipicamente `7881/tcp` e uma faixa UDP.

> **HTTPS não é opcional.** Fora de `localhost`, o navegador só libera câmera e
> microfone em contexto seguro. Em HTTP puro, `navigator.mediaDevices` vem
> `undefined` e nada funciona.

---

## Rodando localmente

```bash
pnpm install
cp .env.example .env.local   # e preencha (veja a tabela abaixo)
pnpm dev                     # http://localhost:3000
```

No primeiro boot o app cria o schema do SQLite e, se ainda não existir nenhum
admin, cria um a partir de `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

Depois de logar como admin, vá em **/admin** e **crie os canais** — o banco
começa vazio, e sem canal não há onde entrar.

### Variáveis de ambiente

| Variável | Obrigatória | Para que serve |
|---|---|---|
| `LIVEKIT_URL` | **sim** | URL do SFU (`wss://…`) |
| `LIVEKIT_API_KEY` | **sim** | Chave de API do LiveKit |
| `LIVEKIT_API_SECRET` | **sim** | Segredo de API do LiveKit |
| `SESSION_SECRET` | **sim em produção** | Assina o cookie de sessão. Gere com `openssl rand -base64 48`. **Em produção o app se recusa a subir sem isso** — de propósito, para não cair num default inseguro sem ninguém perceber. |
| `ADMIN_USERNAME` | 1º boot | Admin inicial. Só tem efeito **enquanto não existir nenhum admin**; depois disso é ignorada e não reseta senha de ninguém. |
| `ADMIN_PASSWORD` | 1º boot | Senha do admin inicial (mínimo 8 caracteres) |
| `DATA_DIR` | não | Diretório de dados. Padrão `./.data` em dev, `/data` na imagem Docker |
| `DATABASE_PATH` | não | Caminho direto do `.db`; tem precedência sobre `DATA_DIR` |
| `AVATARS_DIR` | não | Diretório das fotos. Padrão: `avatars/` dentro do `DATA_DIR` |
| `NEXT_PUBLIC_SHOW_SETTINGS_MENU` | não | Exibe o menu de configurações do LiveKit |

Nunca versione valores reais — o `.env.example` existe só para documentar os
nomes, e o `.gitignore` já cobre `.env*.local`, `*.db` e o diretório de dados.

### Scripts

```bash
pnpm dev            # servidor de desenvolvimento
pnpm build          # build de produção
pnpm start          # sobe o build
pnpm lint           # ESLint
pnpm test           # Vitest
pnpm format:write   # Prettier
```

---

## Rodando com Docker

```bash
docker build -t concord .

docker run -d --name concord \
  -p 3000:3000 \
  -v concord-data:/data \
  -e LIVEKIT_URL="wss://seu-livekit.exemplo" \
  -e LIVEKIT_API_KEY="..." \
  -e LIVEKIT_API_SECRET="..." \
  -e SESSION_SECRET="$(openssl rand -base64 48)" \
  -e ADMIN_USERNAME="admin" \
  -e ADMIN_PASSWORD="troque-isso" \
  concord
```

> **O volume não é opcional.** Contas, canais, mensagens e fotos vivem em
> `/data`. Sem volume, tudo isso desaparece a cada redeploy.
>
> Use um **volume nomeado**, não um *bind mount* de diretório do host. O
> container roda como usuário não-root (uid 1001) e a imagem já cria `/data`
> com o dono correto; um volume nomeado herda essa permissão. Um diretório do
> host normalmente pertence a outro UID e o SQLite falha com
> `unable to open database file`. Se precisar mesmo de bind mount, rode antes
> `chown -R 1001:1001 <diretório>`.

Para deploy em PaaS (Coolify, Dokploy e afins), veja
[`MIGRACAO.md`](./MIGRACAO.md).

---

## Estrutura

```
app/
  api/
    auth/                 login, logout, sessão atual, troca de senha
    channels/             CRUD de canais, presença, mensagens (+ SSE)
    users/                administração de contas
    members/              lista pública mínima (id, username, avatar)
    avatars/              upload e entrega das fotos
    connection-details/   emissão do token do LiveKit
  admin/                  painel de administração
  rooms/[roomName]/       tela de chamada
  channels/[slug]/        canal de texto
  login/  profile/
lib/
  db.ts, auth.ts, session.ts, api-auth.ts     fundação (dados e sessão)
  CallStage.tsx, CallControlBar.tsx,
  CallParticipantTile.tsx                     tela de chamada
  ChannelSidebar.tsx, MembersPanel.tsx,
  TextChannelPanel.tsx                        navegação e texto
  ParticipantAudioPanel.tsx,
  noiseSuppression.ts, useSpeakingIndicator.ts  áudio
```

### Duas decisões que valem conhecer antes de mexer

**A tela de chamada não usa `<VideoConference>`.** Ela é composta à mão
(`CallStage` + `CallControlBar` + `CallParticipantTile`) porque aquele
componente não permite customizar o tile do participante nem injetar controles
na barra — e precisávamos das duas coisas. Só é usada API pública da biblioteca.

⚠️ **`<RoomAudioRenderer />` em `CallStage.tsx` é obrigatório.** É ele que
reproduz o áudio de todo mundo, inclusive o do compartilhamento de tela. Vinha
de graça dentro do `<VideoConference>`; ao compor à mão, virou responsabilidade
nossa. **Se ele sumir, ninguém ouve ninguém** — e nenhum teste de tipo ou build
vai acusar isso.

**`webAudioMix: true` nas `RoomOptions` não é enfeite.** Sem `audioContext`, o
`setVolume` cai no `volume` do elemento `<audio>`, que o navegador limita a
1.0 — e o volume por participante deixa de passar de 100%.

---

## Limitações conhecidas

- **Uma réplica só.** O barramento de mensagens do chat é em memória; escalar
  para múltiplas réplicas quebra a entrega em tempo real.
- **Supressão de ruído é só a do navegador** (`noiseSuppression`,
  `echoCancellation`, `autoGainControl`, `voiceIsolation`). O
  `@livekit/krisp-noise-filter` está nas dependências mas **só funciona no
  LiveKit Cloud** — numa instância self-hosted ele se desliga sozinho.
- **Áudio no compartilhamento de tela depende do navegador**, não do código:
  Chrome/Edge no Windows compartilham sistema ou aba; Chrome no Linux **só
  aba**; Firefox não suporta. O app avisa quando a faixa de áudio não foi
  publicada.
- **Sessão sem revogação.** O cookie dura 30 dias e não há lista de revogação:
  trocar a senha não derruba sessões em outros dispositivos.
- **Sem limite de tentativas no login.** Aceitável para um grupo fechado de
  poucas pessoas; é o primeiro item a corrigir se a base de usuários crescer.

---

## Licença

Apache 2.0, herdada do [LiveKit Meet](https://github.com/livekit-examples/meet).
Veja [`LICENSE`](./LICENSE).
