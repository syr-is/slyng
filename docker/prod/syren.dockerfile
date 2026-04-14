# syntax=docker/dockerfile:1
# ---- Base Stage ----
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# ---- Dependencies Stage ----
FROM base AS deps

# Copy app and packages package.json for dependency resolution
COPY apps/syren/app/package.json ./apps/syren/app/
COPY packages/ts/types/package.json ./packages/ts/types/

# Enable injection only for Docker builds (required for pnpm deploy in v10)
RUN echo "inject-workspace-packages=true" >> .npmrc
# Install all dependencies (including devDependencies for build)
RUN pnpm install

# ---- Builder Stage ----
FROM deps AS builder

COPY apps/syren ./apps/syren
COPY packages ./packages

# Build workspace packages first (order matters: types first, then app)
RUN pnpm --filter @syren/types build
RUN pnpm --filter @syren/app build

# Prune dev dependencies
RUN pnpm --filter @syren/app --prod deploy pruned

# ---- Production Stage ----
FROM node:20-alpine AS production

# Set production environment
ENV NODE_ENV=production
ENV PORT=5174

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 sveltekit

# Copy built application and production dependencies
COPY --from=builder --chown=sveltekit:nodejs /app/pruned/package.json ./
COPY --from=builder --chown=sveltekit:nodejs /app/pruned/node_modules ./node_modules
COPY --from=builder --chown=sveltekit:nodejs /app/apps/syren/app/build ./build

# Switch to non-root user
USER sveltekit

# Expose the port
EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Start the production server
CMD ["sh", "-c", "HOST=0.0.0.0 PORT=${PORT} node build"]
