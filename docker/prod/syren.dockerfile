# syntax=docker/dockerfile:1
# ---- Base Stage ----
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# ---- WASM Builder Stage ----
# Compile the syren-client Rust crate to wasm32. Kept in its own stage
# so the Rust toolchain doesn't bloat the Node builder, and so the
# WASM artefacts cache independently of JS dependency churn. Debian
# base over Alpine because rustup ships with the official rust image
# and wasm-pack drives rustup to install the wasm32 target.
#
# 1.86 minimum: transitive deps (e.g. `time` 0.3.47) declare
# `edition = "2024"` in their Cargo.toml, which Cargo only parses
# from 1.85 onward. Without this bump the build fails with
# "feature `edition2024` is required" before any WASM compiles.
FROM rust:1.86-bookworm AS wasm-builder

# Pinned wasm-pack matches what `pnpm --filter @syren/client build`
# would invoke locally; pin keeps Docker builds reproducible.
RUN cargo install --locked wasm-pack@0.13.1
RUN rustup target add wasm32-unknown-unknown

WORKDIR /build

# Only the Rust source is needed — wasm-pack reads Cargo.toml and the
# crate's src/.
COPY packages/rust ./packages/rust

RUN cd packages/rust/syren-client \
    && wasm-pack build --release --target web --out-dir /build/wasm-out/web --no-pack \
    && wasm-pack build --release --target nodejs --out-dir /build/wasm-out/node --no-pack

# ---- Dependencies Stage ----
FROM base AS deps

COPY apps/syren/web/package.json ./apps/syren/web/
COPY packages/ts/types/package.json ./packages/ts/types/
COPY packages/ts/ui/package.json ./packages/ts/ui/
COPY packages/ts/app-core/package.json ./packages/ts/app-core/
COPY packages/ts/client/package.json ./packages/ts/client/

RUN echo "inject-workspace-packages=true" >> .npmrc
RUN pnpm install

# ---- Builder Stage ----
FROM deps AS builder

ARG PUBLIC_URL=https://slyng.gg
ARG SYREN_API_URL=https://slyng.gg

ENV PUBLIC_URL=${PUBLIC_URL}
ENV SYREN_API_URL=${SYREN_API_URL}

COPY apps/syren ./apps/syren
COPY packages ./packages

# Slot the prebuilt WASM artefacts into @syren/client's expected dist
# layout so the package's `tsc` step can run without re-invoking
# wasm-pack (no Rust toolchain in this image).
COPY --from=wasm-builder /build/wasm-out/web ./packages/ts/client/dist/wasm/web
COPY --from=wasm-builder /build/wasm-out/node ./packages/ts/client/dist/wasm/node

# Build workspace packages first (dist/ doesn't exist at install time with injection).
# Order: types → client → app-core → ui (each depends on the previous).
RUN pnpm --filter @syren/types build
# @syren/client's full build = wasm-pack + tsc + node ESM wrapper. Run
# only the steps that don't need Rust: emit the Node ESM wrapper, then
# tsc against src/. WASM dist/ was injected from wasm-builder above.
RUN cd packages/ts/client \
    && node scripts/generate-node-esm-wrapper.mjs \
    && pnpm exec tsc
RUN pnpm --filter @syren/app-core build
RUN pnpm --filter @syren/ui build

# Re-inject now that all dist/ folders exist
RUN pnpm install

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
