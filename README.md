# Syren

Federated real-time chat on the syr platform.

> **Note:** Syren is a vibecoded platform with zero architectural considerations. The majority of it was written in under a day. It exists solely to showcase Syr's platform delegation capabilities and the capabilities of human-driven people discovery over an algorithmic/AI-driven shared heap architecture.

## Dev

```bash
docker compose up -d   # SurrealDB + SeaweedFS
pnpm install
pnpm dev               # all apps
# or
pnpm dev:syren         # just the chat app
```

The app listens on `http://localhost:5174`. API on `:5175`. Adjust `.env` to bind a LAN IP if testing across devices.

## Voice / video / screen share — browser setup

Voice features use `navigator.mediaDevices.getUserMedia` / `getDisplayMedia`, which browsers only expose in a **secure context**: HTTPS, or `http://localhost` / `127.0.0.1`. On a bare-IP LAN origin like `http://192.168.1.10:5174`, these APIs are `undefined` and joining a voice channel will toast "media unavailable".

Two options: serve over HTTPS, or whitelist the insecure origin for development.

### Chrome / Edge / Brave — whitelist an insecure origin

1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Enable **"Insecure origins treated as secure"**
3. In the textbox, add your LAN origin(s). Example for a machine at `192.168.1.10` running on the default ports:
   ```
   http://192.168.1.10:5174,http://192.168.1.10:5175
   ```
   Comma-separate multiple origins. Include the API origin if it differs from the app's — needed for the WebSocket handshake.
4. **Relaunch** Chrome (the banner at the bottom of the flags page).
5. Also visit `chrome://settings/content/microphone` and `chrome://settings/content/camera` — confirm the origin is not blocked.

### Firefox — enable insecure media-device access

1. `about:config`
2. Set both:
   - `media.devices.insecure.enabled` → `true`
   - `media.getusermedia.insecure.enabled` → `true`
3. Restart Firefox.

### Safari

Safari has no equivalent dev toggle. Use HTTPS (run Vite with `--https` + a `mkcert`-signed cert) or test from `localhost`.

### HTTPS alternative (any browser)

```bash
brew install mkcert
mkcert -install
mkcert 192.168.1.10 localhost
```

Point the Vite `server.https` config at the generated `.pem` pair. The API needs the same treatment for WS to work over `wss://`.

## First-time voice setup

1. Open **avatar menu → Settings → Audio**.
2. Click **Test microphone** — the level meter should respond to speech. If the meter is dead, check the browser's mic permission chip in the address bar.
3. **Video** tab → **Start preview** to confirm the camera.
4. Join a voice channel → use the camera / screen-share toggles in the bottom-left voice controls.

## Project layout

| Path | What |
|------|------|
| `apps/syren/app` | SvelteKit SPA (client) |
| `apps/syren/api` | NestJS API + WS gateway |
| `packages/ts/types` | Shared Zod schemas (`@syren/types`) |
| `packages/ts/ui` | shadcn-svelte component package (`@syren/ui`) |

See `CLAUDE.md` for conventions.
