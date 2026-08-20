# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runner
# DATA_DIR: onde o SQLite guarda o app.db. Monte um volume persistente do
# Coolify aqui — o container em si é efêmero (ver MIGRACAO.md).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# node:sqlite é builtin do Node — não precisa de toolchain de build (python3/
# make/g++) nem de módulo nativo pra copiar entre estágios, diferente de
# better-sqlite3. Só precisamos garantir que o diretório de dados exista e
# pertença ao usuário não-root que roda o processo.
# /data/avatars: fotos de perfil enviadas pelos usuários (ONDA C), mesmo
# volume persistente do SQLite — precisa existir e pertencer ao uid 1001
# antes do primeiro upload (instrumentation.ts também garante isso no boot,
# mas criar aqui evita depender só disso numa imagem nova).
RUN mkdir -p /data/avatars /data/attachments /data/sounds && chown -R nextjs:nodejs /data
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
