# syntax=docker/dockerfile:1
# Dev API container. Builds @syren/types + @syren/idp-crypto (wasm-pack) and
# the NestJS API, then runs it straight from the workspace dist (no prod
# prune). Connects to the other compose services by name (surrealdb,
# seaweedfs, livekit); env is supplied by docker-compose.
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# wasm-pack builds the vendored syr crypto crates for @syren/idp-crypto.
# libc6-compat provides the glibc ELF loader so wasm-pack's downloaded
# wasm-bindgen (glibc-linked) runs on Alpine's musl libc.
RUN echo "http://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories \
    && apk update \
    && apk add --no-cache wasm-pack libc6-compat

# Workspace manifests first (cacheable install layer). Every package.json
# referenced by the workspace graph must be present for pnpm to resolve,
# even the front-end packages the API never builds against.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/syren/api/package.json ./apps/syren/api/
COPY packages/ts/types/package.json ./packages/ts/types/
COPY packages/ts/ui/package.json ./packages/ts/ui/
COPY packages/ts/app-core/package.json ./packages/ts/app-core/
COPY packages/ts/client/package.json ./packages/ts/client/
COPY packages/ts/idp-crypto/package.json ./packages/ts/idp-crypto/

RUN pnpm install --frozen-lockfile

# Only what the API builds against. packages/rust in full — the Cargo
# workspace manifest lists every member, so idp-crypto won't build without
# the sibling crates present.
COPY apps/syren/api ./apps/syren/api
COPY packages/ts/types ./packages/ts/types
COPY packages/ts/idp-crypto ./packages/ts/idp-crypto
COPY packages/rust ./packages/rust

RUN pnpm --filter @syren/types build \
    && pnpm --filter @syren/idp-crypto build \
    && pnpm --filter @syren/api build

EXPOSE 5175

CMD ["node", "apps/syren/api/dist/main.js"]
