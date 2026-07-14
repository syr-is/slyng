# syntax=docker/dockerfile:1
# ---- Base Stage ----
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# ---- Dependencies Stage ----
FROM base AS deps

# The root package.json declares @syren/app-core, @syren/ui, and
# @syren/types as workspace dependencies, so pnpm install validates
# the whole workspace graph even with --filter. Every package.json
# referenced transitively must be staged — including @syren/client
# (transitively required by @syren/app-core) — or pnpm refuses to
# proceed. The actual *source* for the front-end packages stays out
# of this image; we only need their package.json files for
# resolution.
COPY apps/syren/api/package.json ./apps/syren/api/
COPY packages/ts/types/package.json ./packages/ts/types/
COPY packages/ts/ui/package.json ./packages/ts/ui/
COPY packages/ts/app-core/package.json ./packages/ts/app-core/
COPY packages/ts/client/package.json ./packages/ts/client/
COPY packages/ts/idp-crypto/package.json ./packages/ts/idp-crypto/

RUN echo "inject-workspace-packages=true" >> .npmrc
RUN pnpm install

# ---- Builder Stage ----
FROM deps AS builder

# wasm-pack from Alpine edge/community — prebuilt binary pulling a
# recent Rust toolchain transitively. Needed for @syren/idp-crypto's
# WASM build (vendored syr crypto crates). Same pattern as
# docker/prod/syren.dockerfile.
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache wasm-pack

# Only stage what the API actually builds against. The front-end
# packages stay out of the image — their package.json was enough for
# the deps install above. packages/rust is needed in full: the Cargo
# workspace manifest lists every member, so cargo refuses to build
# syren-idp-crypto without the sibling crates present.
COPY apps/syren/api ./apps/syren/api
COPY packages/ts/types ./packages/ts/types
COPY packages/ts/idp-crypto ./packages/ts/idp-crypto
COPY packages/rust ./packages/rust

# Build types + idp-crypto (wasm-pack + tsup), then API
RUN pnpm --filter @syren/types build
RUN pnpm --filter @syren/idp-crypto build
RUN pnpm --filter @syren/api build

# Drop wasm-pack and the edge repo — the Rust toolchain has no
# business in later layers.
RUN apk del wasm-pack \
    && sed -i '/alpine\/edge\/community/d' /etc/apk/repositories \
    && rm -rf /var/cache/apk/*

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
