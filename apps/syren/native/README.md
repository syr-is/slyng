# @syren/native

Tauri 2 shell wrapping the Syren SvelteKit SPA. Lets the user point at any Syren API host of their choice — first launch shows a setup screen; the chosen host is persisted via `@tauri-apps/plugin-store` and can be changed from Settings.

## Prerequisites

- Rust toolchain (`rustup default stable`)
- Tauri 2 system deps for your OS — see https://v2.tauri.app/start/prerequisites/
- Node 20+, pnpm

## Develop

```bash
pnpm install            # from repo root
pnpm --filter @syren/native tauri:dev
```

Or just the SvelteKit frontend (no Tauri shell, useful for UI iteration in a browser):

```bash
pnpm --filter @syren/native dev
```

## Build

```bash
pnpm --filter @syren/native tauri:build
```

Produces installable artifacts under `apps/syren/native/src-tauri/target/release/bundle/`.

## Architecture notes

- API base URL is resolved at runtime via `@syren/app-core/host`. The native app calls `setHost(<user-chosen URL>)` from `+layout.ts` after reading the persisted host out of `@tauri-apps/plugin-store`. If unset, the layout redirects to `/setup`.
- All API requests use `credentials: 'include'`. The API server's CORS allowlist must permit the Tauri webview origin (`tauri://localhost`, `https://tauri.localhost`); this is wired in `apps/syren/api/src/main.ts`.
- Icons in `src-tauri/icons/` need to be generated before the first `tauri build`. Use `pnpm tauri icon path/to/icon.png` (1024×1024 source).
- Mobile (iOS / Android) targets work with `pnpm tauri ios init` / `pnpm tauri android init`.
