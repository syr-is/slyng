# Syren

Syr-based real-time chat application. Users authenticate via syr's OAuth2 provider.

## Monorepo Structure

- `apps/syren/app` - Main SvelteKit chat application
- `packages/ts/types` - Shared Zod v4 schemas (messages, channels, users, API)

## Tech Stack

- **Frontend**: Svelte 5 (runes), SvelteKit 2, Tailwind CSS 4, shadcn-svelte
- **Backend**: SvelteKit API routes + hooks
- **Database**: SurrealDB (chat data)
- **Auth**: OAuth2 via syr (authorization code flow)
- **Validation**: Zod v4
- **Build**: Vite 7, Turborepo, pnpm workspaces

## Commands

```bash
pnpm dev          # Start all apps in dev mode
pnpm dev:syren    # Start just the chat app
pnpm build        # Build all packages and apps
pnpm lint         # Lint all packages
pnpm check        # Type-check all packages
pnpm test         # Run all tests
pnpm format       # Format all files
```

## Code Conventions

- Prettier: tabs, single quotes, no trailing commas, 100 char width
- ESLint: flat config, typescript-eslint, svelte plugin
- TypeScript strict mode everywhere
- Zod schemas in `@syren/types`, imported by apps
- Repository pattern for SurrealDB data access
- Controller pattern for business logic
- API response format: `{ status, data?, error?, meta? }`

## Docker

```bash
docker compose up -d   # Start SurrealDB + Surrealist
pnpm dev:syren         # Start the app against Docker services
```
