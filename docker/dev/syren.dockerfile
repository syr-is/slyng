FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./

# Copy app and packages package.json for dependency resolution
COPY apps/syren/app/package.json ./apps/syren/app/
COPY packages/ts/types/package.json ./packages/ts/types/

# Install dependencies from workspace root
RUN pnpm install --frozen-lockfile

# Copy application source code
COPY apps/syren/app ./apps/syren/app
COPY packages ./packages

# Set default port (can be overridden by env variable)
ENV PORT=5174

# Expose the port
EXPOSE ${PORT}

# Run dev server with host binding and custom port
CMD ["sh", "-c", "pnpm dev -- --host 0.0.0.0 --port ${PORT}"]
