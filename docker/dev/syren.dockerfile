# syntax=docker/dockerfile:1
# Dev web-client container. Builds the workspace packages once (so Vite can
# resolve @syren/{types,client,app-core,ui} from their dist/), then runs the
# SvelteKit dev server. The app's own source is bind-mounted by compose for
# hot-reload; edits to the shared packages need a rebuild of this image.
#
# The API is NOT bundled here — the Vite dev proxy forwards /api, /ws and
# /.well-known to SYREN_API_PROXY (default the host-run API on :5175).
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# wasm-pack (prebuilt from Alpine edge/community) builds the @syren/client
# crate — same approach as docker/prod/syren.dockerfile. libc6-compat
# provides the glibc ELF loader so wasm-pack's downloaded (glibc-linked)
# wasm-bindgen binary runs on Alpine's musl libc.
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache wasm-pack libc6-compat

# Workspace manifests first — keeps the pnpm install layer cacheable.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/syren/web/package.json ./apps/syren/web/
COPY packages/ts/types/package.json ./packages/ts/types/
COPY packages/ts/ui/package.json ./packages/ts/ui/
COPY packages/ts/app-core/package.json ./packages/ts/app-core/
COPY packages/ts/client/package.json ./packages/ts/client/

RUN pnpm install --frozen-lockfile

# Source for the workspace packages + web app.
COPY apps/syren ./apps/syren
COPY packages ./packages

# Build the workspace packages in dependency order (client runs wasm-pack).
RUN pnpm --filter @syren/types build \
    && pnpm --filter @syren/client build \
    && pnpm --filter @syren/app-core build \
    && pnpm --filter @syren/ui build

EXPOSE 5174

# Vite dev server on all interfaces. The proxy target comes from
# SYREN_API_PROXY (set by compose); vite.config also binds host by default.
CMD ["pnpm", "--filter", "@syren/web", "dev", "--", "--host", "0.0.0.0", "--port", "5174"]
