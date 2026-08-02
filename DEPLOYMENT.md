# Slyng Production Deployment

Deploying Slyng on Dokploy (Hetzner) behind Cloudflare.

---

## Architecture

```
Browser → Cloudflare → Traefik (Dokploy) → Docker containers
```

| Container | Port | Domain |
|-----------|------|--------|
| slyng (SPA, sirv) | 5174 | app.slyng.gg |
| slyng-api (NestJS) | 5175 | app.slyng.gg/api, app.slyng.gg/ws |
| surrealdb | 8000 | internal only |
| minio | 9000 (S3) / 9001 (console) | s3.slyng.gg (S3 only) |
| livekit | 7880 | lk.slyng.gg |

---

## Cloudflare Setup

### DNS Records

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `app` | `<server-ip>` | Proxied |
| A | `s3` | `<server-ip>` | Proxied |
| A | `lk` | `<server-ip>` | DNS only (grey cloud) |
| A | `*` | `<server-ip>` | Proxied |

The wildcard record is required so `cf_clearance` cookies from `app.slyng.gg` cover `s3.slyng.gg` (same root domain). Without it, S3 presigned uploads get 403'd by Bot Fight Mode.

### SSL/TLS

- **Encryption mode**: Full (Strict)
- **Edge Certificates → Always Use HTTPS**: On
- **Minimum TLS Version**: 1.2

### Security

- **Bot Fight Mode**: OFF. Free plan Bot Fight Mode can't be skipped per-path. It blocks server-to-server API calls and S3 presigned uploads. The API has its own auth.
- **WAF Custom Rule** (optional, useful if upgrading to Pro):
  - Name: `Allow platform APIs`
  - Expression: `(http.request.uri.path contains "/api/platform/")`
  - Action: Skip all WAF components

### LiveKit

`lk.slyng.gg` must be **DNS only** (grey cloud). LiveKit needs direct UDP for WebRTC media. Cloudflare proxy would force TCP fallback.

---

## Hetzner Firewall

Open these ports for LiveKit:

| Port | Protocol | Purpose |
|------|----------|---------|
| 7880 | TCP | LiveKit signaling |
| 7881 | TCP | RTC TCP fallback |
| 50000-50100 | UDP | WebRTC media |

---

## Dokploy Setup

### Compose Project

- Point at the Slyng repo
- Compose file: `docker-compose.prod.yml`
- Watch paths:
  ```
  apps/slyng/web/**
  apps/slyng/api/**
  packages/ts/types/**
  packages/ts/ui/**
  packages/ts/app-core/**
  packages/ts/client/**
  packages/ts/idp-crypto/**
  packages/rust/**
  docker-compose.prod.yml
  docker/prod/**
  scripts/**
  ```

  Both prod Dockerfiles build `app-core`, `idp-crypto` and `packages/rust`
  (wasm-pack) — not just `types` + `ui` — so those must be watched or a push
  touching only a store or a Rust type silently fails to trigger a deploy.
  `s3/s3_config.json` is deliberately absent: it was SeaweedFS IAM config, and
  `ObjectStoreService` now does bucket + policy setup at runtime.

### Domain Routing

| Service | Host | Path | Port | HTTPS |
|---------|------|------|------|-------|
| slyng | app.slyng.gg | / | 5174 | Yes |
| slyng-api | app.slyng.gg | /api | 5175 | Yes |
| slyng-api | app.slyng.gg | /ws | 5175 | Yes |
| slyng-api | app.slyng.gg | /.well-known/syr | 5175 | Yes |
| slyng-api | app.slyng.gg | /.well-known/did | 5175 | Yes |
| minio | s3.slyng.gg | / | 9000 | Yes |
| livekit | lk.slyng.gg | / | 7880 | Yes |

**Important**: Path must be `/api` not `/api/*`. Traefik uses `PathPrefix`, not globs.

**`.well-known` routing**: the `/.well-known/syr` + `/.well-known/did` prefixes
are the syr federation discovery endpoints (instance manifest, per-DID
manifests, DID documents) served by the API at the site root — required for
slyng's local identity provider. They must route to slyng-api, not the SPA.
Do NOT route all of `/.well-known` — ACME HTTP-01 challenges and other
well-known consumers may need the default handling.

---

## Environment Variables

> **Required in production.** The API refuses to start or fails at request
> time without these, and `docker-compose.prod.yml` now fails the deploy by
> name rather than letting them default:
>
> | Variable | Why | Generate |
> |---|---|---|
> | `PLATFORM_DELEGATE_SECRET` | Unlocks the local-IdP delegate key. Missing or shorter than 32 chars produced `500 Registration failed` on the observed deployment while unrelated routes continued to serve, which obscured the configuration error. | `openssl rand -hex 32` |
> | `SLYNG_JWT_SECRET` | Signs issued tokens. `IdpJwtService.getSecret()` throws outright when `NODE_ENV=production`. | `openssl rand -hex 32` |
>
> Both are length-checked at boot (`assertSecrets` in `main.ts`): under 32 chars, the process refuses to start. Compose's `${VAR:?}` cannot do this — it rejects unset and empty values only, so `SLYNG_JWT_SECRET=x` would otherwise deploy cleanly as a one-character signing key.
>
> Strongly recommended: `SLYNG_SESSION_SECRET` and `SLYNG_STATE_SECRET`.
> Unset, both fall back to a **per-process random**, so OAuth state and
> issued tokens are invalidated by every restart — including every deploy.
>
> **These have to be in the compose `environment:` block, not just in the
> deployment environment.** They were absent from it for a while, so setting
> them in Dokploy did nothing: the container never received them. If you add
> a variable the API reads, add it in both places. To check for drift:
>
> ```bash
> # Reads every `config.get('X')` AND `process.env.X`, collapsing whitespace
> # first — chained calls span lines, which is how KLIPY_WEB (the key that
> # enables the GIF picker) hid from a line-based grep.
> python3 - <<'EOF'
> import re, pathlib
> api = {}
> for f in pathlib.Path('apps/slyng/api/src').rglob('*.ts'):
>     if f.name.endswith('.test.ts'): continue
>     flat = re.sub(r'\s+', ' ', f.read_text(errors='ignore'))
>     for m in re.finditer(r"config\s*\.\s*get\s*(?:<[^>]*>)?\s*\(\s*'([A-Z0-9_]+)'", flat):
>         api[m.group(1)] = 1
>     for m in re.finditer(r"process\s*\.\s*env\s*(?:\.\s*([A-Z0-9_]+)|\[\s*'([A-Z0-9_]+)')", flat):
>         api[m.group(1) or m.group(2)] = 1
> compose = set(re.findall(r'^      - ([A-Z0-9_]+)=',
>     re.search(r'  slyng-api:.*?(?=\n  slyng:)', open('docker-compose.prod.yml').read(), re.S).group(0), re.M))
> example = set(re.findall(r'^#? *([A-Z0-9_]+)=', open('.env.example').read(), re.M))
> print('read by API, NOT passed by compose :', sorted(set(api) - compose) or 'none')
> print('read by API, NOT in .env.example   :', sorted(set(api) - example) or 'none')
> print('in compose, never read by the API  :', sorted(compose - set(api)) or 'none')
> EOF
> ```
>
> The first two must be empty. The third catches the opposite drift — a
> variable still passed in after the code stopped reading it — and has one
> known entry today: `SYR_INSTANCE_URL` is declared in both compose files and
> read nowhere in the repo. Left in place deliberately rather than deleted on
> the strength of a grep; treat any *other* name appearing there as drift.


```env
NODE_ENV=production
PORT=5174
PUBLIC_URL=https://app.slyng.gg

SURREALDB_URL=ws://surrealdb:8000/rpc
SURREALDB_NAMESPACE=slyng
SURREALDB_DATABASE=slyng
SURREALDB_USER=root
SURREALDB_PASS=<openssl rand -base64 32>

SLYNG_API_PORT=5175
SLYNG_API_URL=https://app.slyng.gg
SYR_INSTANCE_URL=https://app.syr.is

S3_PROVIDER=minio
S3_ENDPOINT=http://minio:9000
S3_BUCKET=slyng
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=slyng-access-key
S3_SECRET_ACCESS_KEY=slyng-secret-key
S3_PUBLIC_URL=https://s3.slyng.gg/slyng
S3_CORS_ORIGINS=https://app.slyng.gg

LIVEKIT_API_KEY=<openssl rand -hex 12>
LIVEKIT_API_SECRET=<openssl rand -base64 32>
LIVEKIT_URL=ws://livekit:7880
LIVEKIT_PUBLIC_URL=wss://lk.slyng.gg
LIVEKIT_NODE_IP=<server-public-ip>
```

For MinIO the S3 credentials double as `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (set on the compose service; the password must be ≥8 chars). They're internal between the API and MinIO — only `s3.slyng.gg` (the S3 API on 9000) is exposed externally. Keep the MinIO console (9001) private.

---

## Gotchas / Lessons Learned

### MinIO

- **Root creds = app S3 creds**. `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` are set to `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` on the compose service (`MINIO_ROOT_PASSWORD` must be ≥8 chars).
- **The app owns setup**. `ObjectStoreService` (`apps/slyng/api/src/storage/`) creates the bucket and applies the anonymous public-read policy (`s3:GetObject` on `uploads/did:syr:*/…/public/*`) via the native `minio` client at API startup — no `s3_config.json`, no init container.
- **CORS** is handled natively by MinIO's `MINIO_API_CORS_ALLOW_ORIGIN` env (set from `S3_CORS_ORIGINS`); the app does not issue `PutBucketCors` for MinIO.
- **AWS SDK checksum workaround**: the S3 clients set `request/responseChecksumCalculation: 'WHEN_REQUIRED'` — MinIO rejects the SDK v3 default checksum headers, which otherwise break presigned browser PUTs.
- **Healthcheck**: `curl -f http://localhost:9000/minio/health/live`.
- **Switch back to SeaweedFS**: set `S3_PROVIDER=seaweedfs` and uncomment the `seaweedfs` service in `docker-compose.yml`.

### SvelteKit SPA (adapter-static)

- Served by `sirv-cli` (not nginx, not adapter-node).
- **Healthcheck must use `0.0.0.0`** not `localhost`. Alpine resolves `localhost` to IPv6 `::1`, but sirv only binds IPv4.
- Build args `PUBLIC_URL` and `SLYNG_API_URL` are baked into the static build at image time.

### pnpm Workspace in Docker

- Must add `inject-workspace-packages=true` to `.npmrc` in deps stage.
- After building workspace packages (types, ui), must run `pnpm install` again so injected copies in `node_modules` get the built `dist/` directories.
- All workspace package.json files must be copied in the deps stage, even if the target app doesn't directly depend on them (root package.json may reference them).

### Presigned S3 URLs

- **Do NOT include `ContentLength` in `PutObjectCommand`** when generating presigned URLs. Cloudflare modifies Content-Length headers, breaking the signature. Only `host` should be in `SignedHeaders`.
- Presigned URLs are generated by the `publicClient` (endpoint: `https://s3.slyng.gg`), not the internal client (`http://minio:9000`). Server-side verification (HeadObject, finalize) uses the internal client.

### LiveKit

- **Cannot use `network_mode: host`** with Dokploy. Dokploy injects its own network, which conflicts. Use explicit port mappings instead.
- **Keep the UDP port range small** (50000-50100, not 50000-60000). Docker creates a proxy process per port mapping; 10k ports locks up Docker on small VMs.
- `LIVEKIT_KEYS` env var overrides the keys in `livekit.yaml` at runtime. No need to edit the yaml for different environments.
- `LIVEKIT_NODE_IP` must be the server's public IP so ICE candidates are routable.

### Cloudflare + Server-to-Server

- SvelteKit's CSRF (`checkOrigin`) blocks server-to-server POST requests from ecosystem apps. Set `csrf: { checkOrigin: false }` in `svelte.config.js` — origin validation is handled in `hooks.server.ts` instead.
- Platform delegation tokens use `sessionId: "platform:xxx"` which doesn't exist in the session table. The auth hooks must skip session lookup for these and just verify the user exists.
- Syr must accept `Authorization: Bearer` header (not just session cookie) for platform delegation tokens from ecosystem apps.

### Builder memory — the SPA build needs ~3.5 GB, and swap

The `@slyng/web` Vite build is the single heaviest thing in a deploy. Measured
peaks by heap cap: **4096 → 3.97 GB**, **3072 → 3.50 GB**, **2048 → fails**
with `JavaScript heap out of memory`. So ~3 GB is the floor for this bundle.

`--max-old-space-size` is an *allowance*, not a reservation — V8 grows toward
it and only collects hard near the limit, so a generous cap on a small builder
is actively harmful. `slyng.dockerfile` pins 3072 for that reason.

**The builder needs swap.** With none, a build that transiently exceeds free
memory is SIGKILLed by the kernel. SIGKILL writes nothing, so the symptom is
not an error — the deployment log stops mid-line and Dokploy records the
deployment as **Cancelled**, not failed. It looks like a queue or webhook
problem and is not one. This bit us on a 7.6 GB host with ~3.5 GB free and no
swap: every deploy after the memory ceiling was crossed came back "Cancelled",
including manual ones, with no error text anywhere.

```bash
free -h                              # Swap: 0B is the tell
sudo dmesg -T | grep -i 'killed process'   # confirms it

sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

3072 narrows the margin; swap is what creates one. A host that also runs other
stacks should have both.

### Docker on Hetzner

- If an object-store container gets stuck where `docker kill` / `docker rm` hang, fix with `systemctl restart docker`, then `docker rm -f <id>`.
- Always clean up stuck containers before redeploying: `docker rm -f $(docker ps -a --filter "name=slyng" -q)`.
- Don't use `container_name` in compose — let Dokploy manage naming.

---

## Syr Instance Requirements

For Slyng to work with a Syr instance, the Syr instance needs:

1. `csrf: { checkOrigin: false }` in `svelte.config.js`
2. `Authorization: Bearer` support in `hooks.server.ts`
3. Platform delegation token handling (skip session lookup for `platform:` prefix)
4. `PLATFORM_DELEGATE_SECRET` env var set (32+ chars)
5. Bot Fight Mode disabled (or WAF skip rule for `/api/platform/`)
