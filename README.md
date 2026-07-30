# Slyng

Federated real-time chat on the syr platform.

> **Note:** Slyng is a vibecoded platform with zero architectural considerations. The majority of it was written in under a day. It exists solely to showcase Syr's platform delegation capabilities and the capabilities of human-driven people discovery over an algorithmic/AI-driven shared heap architecture.

## Dev

```bash
docker compose up -d   # SurrealDB + MinIO + LiveKit
pnpm install
pnpm dev               # all apps
# or
pnpm dev:slyng         # just the chat app
```

The app listens on `http://localhost:5174`. API on `:5175`. Adjust `.env` to bind a LAN IP if testing across devices.

### App in Docker

The API and web client can run in containers instead of on the host — both live behind an opt-in `app` compose profile, so a plain `docker compose up -d` still brings up infra only.

**Full stack (infra + API + web):**

```bash
docker compose --profile app up -d
```

Then open the app at your `PUBLIC_URL` (e.g. `http://192.168.1.10:5174`). The API container connects to the other services by name and reads secrets + `PUBLIC_URL` from `.env`, so it matches a host-run API against the same SurrealDB — existing accounts and sessions stay valid.

**Just the web client** (keep the API on the host):

```bash
SLYNG_API_PROXY=http://host.docker.internal:5175 docker compose up -d slyng-web
```

The web container's Vite dev proxy forwards `/api`, `/ws` and `/.well-known` to `SLYNG_API_PROXY` — the containerized `slyng-api` by default, or override it to point at a host-run API (`pnpm dev:api`) or any LAN address.

The web app's own source hot-reloads (bind-mounted). Editing a shared package (`@slyng/ui`, `@slyng/app-core`, …) or the API needs a rebuild: `docker compose build slyng-web slyng-api`.

### Local identity provider

Slyng can act as a full syr instance: users can sign up locally (username +
password) and get a `did:syr` identity hosted by slyng itself — no external
syr instance required. Configure in `.env` (see `.env.example` for details):

```
SLYNG_JWT_SECRET=...            # ≥32 chars — signs session/platform tokens
PLATFORM_DELEGATE_SECRET=...    # ≥32 chars — encrypts delegate keys at rest; treat like a KMS key
SLYNG_REGISTRATION_MODE=open    # open | invite_only | closed
```

Generate secrets with `openssl rand -hex 32`. Both must stay stable across
restarts; changing `PLATFORM_DELEGATE_SECRET` invalidates every existing
delegation.

### LiveKit (voice/video)

Voice and video use a self-hosted [LiveKit](https://livekit.io) SFU running in Docker. The `docker compose up -d` command starts it alongside SurrealDB and MinIO.

For **cross-device testing**, set `LIVEKIT_NODE_IP` in `.env` to your machine's LAN IP so ICE candidates are routable:

```
LIVEKIT_NODE_IP=192.168.1.10
LIVEKIT_URL=ws://192.168.1.10:7880
```

> **macOS Docker hairpin NAT caveat:** When LiveKit is hosted on the same machine you're testing from, the host device may be able to receive audio but not send it. This is a Docker Desktop for Mac limitation — the container's port mapping doesn't handle traffic that originates from and routes back to the same host correctly. Other devices on the LAN work fine bidirectionally. This does not occur on Linux (native Docker) or in production deployments.

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
| `apps/slyng/web` | SvelteKit SPA (web client) |
| `apps/slyng/api` | NestJS API + WS gateway |
| `packages/ts/types` | Shared Zod schemas (`@slyng/types`) |
| `packages/ts/ui` | shadcn-svelte component package (`@slyng/ui`) |

See `CLAUDE.md` for conventions.
