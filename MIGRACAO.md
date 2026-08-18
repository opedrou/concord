# Migração — fundação de auth + canais (Coolify)

Passo a passo pra colocar em produção o backend de autenticação e canais
permanentes (ONDA 1). Sem isso a app não sobe: falta `SESSION_SECRET` derruba
o processo em produção de propósito.

## 1. Volume persistente

O container é efêmero — sem volume, o banco SQLite (usuários e canais) some a
cada deploy/restart.

No Coolify, na aba **Storages** da aplicação:

- **Adicionar volume**
- Tipo: **Volume Mount** (volume nomeado gerenciado pelo Docker — **não** use
  "Directory Mount"/bind mount de um caminho do host).
- Destination Path (dentro do container): **`/data`**
- Nome: qualquer um, ex. `call-selfhost-data`

Por que volume nomeado e não bind mount de diretório do host: o Dockerfile já
cria `/data` na imagem com dono `nextjs:nodejs` (o container roda como
usuário não-root, uid 1001). Um volume nomeado herda essa permissão no
primeiro uso. Um bind mount de um diretório arbitrário do host normalmente
pertence a outro UID e o SQLite falha com `unable to open database file` —
já foi reproduzido localmente durante a validação. Se por algum motivo
precisar de bind mount mesmo assim, rode antes `chown -R 1001:1001
<diretório-no-host>`.

## 2. Variáveis de ambiente

Na aba **Environment Variables** da aplicação, além das que já existiam
(`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`), adicionar:

| Variável | Obrigatória | Valor |
|---|---|---|
| `SESSION_SECRET` | **Sim** | Segredo aleatório longo pra assinar o cookie de sessão. Gerar com `openssl rand -base64 48`. **A app recusa subir em produção sem isso** — não existe fallback inseguro. |
| `ADMIN_USERNAME` | Só no 1º boot | Username do primeiro admin. |
| `ADMIN_PASSWORD` | Só no 1º boot | Senha do primeiro admin. |
| `DATA_DIR` | Não | Default `/data` (já setado no Dockerfile) — não precisa mexer, só documentando. |

`ADMIN_USERNAME`/`ADMIN_PASSWORD` só têm efeito **enquanto não existir nenhum
admin no banco**. Depois que o primeiro admin for criado, essas duas
variáveis podem ficar (não fazem nada) ou ser removidas — gerenciar
usuários daí em diante é via `/api/users` (rotas admin), não mais via env.

## 3. Como o primeiro admin é criado

No boot do container (hook `instrumentation.ts`, roda uma vez quando o
processo Node sobe):

1. Garante o schema do SQLite em `$DATA_DIR/app.db` (idempotente, não apaga
   dados existentes).
2. Verifica se já existe algum usuário com `is_admin = 1`.
3. Se **não** existir nenhum admin, cria um a partir de `ADMIN_USERNAME` +
   `ADMIN_PASSWORD`. Se essas variáveis não estiverem definidas nesse
   momento, a app sobe mesmo assim, mas ninguém consegue logar (fica um
   aviso no log do container) — defina as variáveis e reinicie.
4. Se já existir um admin, essa etapa não faz nada (mesmo se
   `ADMIN_USERNAME`/`ADMIN_PASSWORD` continuarem definidas) — não reseta
   senha de admin existente.

Depois do primeiro login como admin, use a UI de administração (onda 3) ou
diretamente as rotas `/api/users` pra criar as contas dos outros
participantes e `/api/channels` pra cadastrar os canais de voz.

## 4. Deploy

Sem mudança em relação ao que já estava documentado no `HANDOFF.md`: fonte
continua sendo o repo privado `call-selfhost`, Base Directory `/`, Dockerfile
Location `/Dockerfile`, porta do container `3000`.

Depois de configurar volume + `SESSION_SECRET` (+ `ADMIN_USERNAME`/
`ADMIN_PASSWORD` no primeiro deploy), faça o redeploy normalmente.

## 5. Checagem pós-deploy

- Log do container deve mostrar `[seed] admin "<usuario>" criado.` no
  primeiro boot.
- `POST /api/auth/login` com as credenciais do admin deve devolver `200` e
  um `Set-Cookie: session=...`.
- Acessar a URL da app sem estar logado deve redirecionar pra `/login`.
- `GET /api/connection-details?roomName=<slug-de-um-canal-que-nao-existe>`
  autenticado deve devolver `404`, nunca emitir token pra sala arbitrária.
