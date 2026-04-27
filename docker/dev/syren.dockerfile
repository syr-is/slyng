FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./

# Copy app and packages package.json for dependency resolution. The
# WASM client (`@syren/client`) is referenced transitively through
# `@syren/app-core`, so pnpm install needs its package.json present
# even though dev mode mounts the host workspace and uses whatever
# `dist/` was built locally.
COPY apps/syren/web/package.json ./apps/syren/web/
COPY packages/ts/types/package.json ./packages/ts/types/
COPY packages/ts/ui/package.json ./packages/ts/ui/
COPY packages/ts/app-core/package.json ./packages/ts/app-core/
COPY packages/ts/client/package.json ./packages/ts/client/

# Install dependencies from workspace root
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY apps/syren/web ./apps/syren/web
COPY packages ./packages

# Set default port (can be overridden by env variable)
ENV PORT=5174

# Expose the port
EXPOSE ${PORT}

# Run dev server with host binding and custom port
CMD ["sh", "-c", "pnpm dev -- --host 0.0.0.0 --port ${PORT}"]
