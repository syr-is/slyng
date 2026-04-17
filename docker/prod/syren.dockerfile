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

# Build workspace packages first (dist/ doesn't exist at install time with injection)
RUN pnpm --filter @syren/types build
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
