# Builds and runs assistant-api and assistant-backoffice as a single Render
# Web Service, one Node process total:
#   - assistant-api binds the one port Render forwards traffic to. It serves
#     the REST API (/api/players), the Discord Interactions Endpoint
#     (/api/discord/interactions — Discord POSTs slash command invocations
#     here directly, no gateway WebSocket involved), and
#     assistant-backoffice's static build (everything else) — see
#     app.module.ts.
#
# A dummy DATABASE_URL is used only for `prisma generate` at build time
# (it never connects, just reads the schema); the real one is supplied by
# Render at runtime.

FROM node:22-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS backoffice-build
COPY discord/assistant-backoffice/package.json discord/assistant-backoffice/package-lock.json ./
RUN npm ci
COPY discord/assistant-backoffice/ ./
RUN npm run build

# ---------------------------------------------------------------------------
FROM base AS api-build
COPY discord/assistant-api/package.json discord/assistant-api/package-lock.json ./
RUN npm ci
COPY discord/assistant-api/ ./
RUN DATABASE_URL="postgresql://user:pass@localhost:5432/postgres" npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

COPY --from=api-build /app/dist ./dist
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/package.json ./package.json
COPY --from=api-build /app/prisma ./prisma
COPY --from=api-build /app/prisma.config.ts ./prisma.config.ts

# Served as a static SPA by ServeStaticModule in src/app.module.ts.
COPY --from=backoffice-build /app/dist ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/main.js"]
