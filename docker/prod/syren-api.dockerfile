# syntax=docker/dockerfile:1
# ---- Base Stage ----
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# ---- Dependencies Stage ----
FROM base AS deps

COPY apps/syren/api/package.json ./apps/syren/api/
COPY packages/ts/types/package.json ./packages/ts/types/

RUN echo "inject-workspace-packages=true" >> .npmrc
# Scope the install to the API's own dependency closure — dragging in
# the front-end packages would also drag in @syren/client (a WASM
# crate whose source we don't want in the API image).
RUN pnpm install --filter @syren/api...

# ---- Builder Stage ----
FROM deps AS builder

# Only stage what the API actually needs. Pulling in the front-end
# packages here would re-introduce @syren/client into the workspace
# and re-trigger the WASM-package-not-found error during deploy.
COPY apps/syren/api ./apps/syren/api
COPY packages/ts/types ./packages/ts/types

# Build types first, then API
RUN pnpm --filter @syren/types build
RUN pnpm --filter @syren/api build

# Prune to production deps
RUN pnpm --filter @syren/api --prod deploy pruned

# ---- Production Stage ----
FROM node:20-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nestjs

# Copy built API and production node_modules
COPY --from=builder --chown=nestjs:nodejs /app/pruned/package.json ./
COPY --from=builder --chown=nestjs:nodejs /app/pruned/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/syren/api/dist ./dist

USER nestjs

EXPOSE 5175

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.SYREN_API_PORT || 5175) + '/reference', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))" || exit 1

CMD ["node", "dist/main"]
