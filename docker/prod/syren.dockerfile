# syntax=docker/dockerfile:1
# ---- Base Stage ----
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# ---- Dependencies Stage ----
FROM base AS deps

COPY apps/syren/web/package.json ./apps/syren/web/
COPY packages/ts/types/package.json ./packages/ts/types/
COPY packages/ts/ui/package.json ./packages/ts/ui/
COPY packages/ts/app-core/package.json ./packages/ts/app-core/
COPY packages/ts/client/package.json ./packages/ts/client/

# No `inject-workspace-packages` here — the web image emits a static
# Vite build (adapter-static) and never invokes `pnpm deploy`, so we
# don't need the hardlinked dist injection that breaks mid-build
# resolution. Default symlinks are what we want: when each upstream
# workspace package writes to its own dist/, downstream packages'
# tsc/Vite see the freshly-built output via the live symlink.
RUN pnpm install

# ---- Builder Stage ----
FROM deps AS builder

# wasm-pack from Alpine edge/community is a prebuilt binary that
# pulls in a recent Rust toolchain transitively — much faster than
# `cargo install` from source. Mirrors the pattern used in the syr
# project's @syr-is/crypto build (docker/prod/syr.dockerfile).
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache wasm-pack

ARG PUBLIC_URL=https://slyng.gg
ARG SYREN_API_URL=https://slyng.gg

ENV PUBLIC_URL=${PUBLIC_URL}
ENV SYREN_API_URL=${SYREN_API_URL}

COPY apps/syren ./apps/syren
COPY packages ./packages

# Build workspace packages in dependency order. `pnpm --filter` runs
# each package's own `build` script, which for @syren/client invokes
# wasm-pack (web + node targets) before the tsc step. Each subsequent
# package's tsc resolves its workspace deps via the symlinks pnpm
# established at install time, picking up dist/ as it lands.
RUN pnpm --filter @syren/types build
RUN pnpm --filter @syren/client build
RUN pnpm --filter @syren/app-core build
RUN pnpm --filter @syren/ui build

# Drop wasm-pack and the edge repo — no need to keep the Rust
# toolchain around for the Vite build.
RUN apk del wasm-pack \
    && sed -i '/alpine\/edge\/community/d' /etc/apk/repositories \
    && rm -rf /var/cache/apk/*

RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter @syren/web build

# ---- Production Stage ----
FROM node:20-alpine AS production

RUN npm i -g sirv-cli

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 sveltekit

COPY --from=builder --chown=sveltekit:nodejs /app/apps/syren/web/build ./build

USER sveltekit

EXPOSE 5174

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://0.0.0.0:5174/ || exit 1

CMD ["sirv", "build", "--single", "--host", "0.0.0.0", "--port", "5174"]
