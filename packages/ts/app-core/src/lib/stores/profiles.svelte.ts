/**
 * Profile resolver — fetches user profiles directly from their syr instance.
 *
 * Slyng stores no profile data. For any DID we know the syr_instance_url,
 * we resolve profile fields by hitting the instance's manifest then its
 * `profile` endpoint. SvelteMap (not a $state record) is used for the cache
 * so dynamic-key access is properly reactive.
 */

import { SvelteMap } from 'svelte/reactivity';
import { WsOp, type RemoteRootResponse } from '@slyng/types';
import { onWsEvent, send } from './ws.svelte';
import { proxied } from '../utils/proxy';
import { idpFetch } from '../idp-fetch';

export interface Profile {
	did: string;
	instance_url: string;
	username?: string;
	display_name?: string;
	bio?: string;
	avatar_url?: string;
	banner_url?: string;
	web_profile_url?: string;
	loading: boolean;
	error?: boolean;
}

interface Manifest {
	endpoints: {
		profile: string;
		stories: string;
		posts: string;
		public_following: string;
		public_emojis: string;
		public_gifs: string;
		/** Root-key rotation chain (P12). Absent on un-rotated / older peers. */
		rotations?: string;
		[key: string]: string | undefined;
	};
	web_profile?: string;
}

const cache = new SvelteMap<string, Profile>();
const manifestCache = new Map<string, Manifest>();
const inflight = new Map<string, Promise<void>>();

function instanceHost(url: string): string {
	try { return new URL(url).host; } catch { return url; }
}

export function getProfile(did: string): Profile | undefined {
	return cache.get(did);
}

async function fetchManifest(did: string, instanceUrl: string): Promise<Manifest> {
	const key = `${instanceUrl}::${did}`;
	const cached = manifestCache.get(key);
	if (cached) return cached;

	const base = instanceUrl.replace(/\/+$/, '');
	const manifestUrl = `${base}/.well-known/syr/${encodeURIComponent(did)}`;
	// Go through slyng's proxy so the remote instance doesn't log the viewer's IP
	const res = await fetch(proxied(manifestUrl), {
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error('manifest fetch failed');
	const manifest = (await res.json()) as Manifest;
	manifestCache.set(key, manifest);
	return manifest;
}

/**
 * Exposed for stores (stories, posts, emojis) that need to resolve an
 * endpoint URL before calling it.
 */
export async function resolveManifest(did: string, instanceUrl: string): Promise<Manifest> {
	return fetchManifest(did, instanceUrl);
}

const rotationCache = new SvelteMap<string, RemoteRootResponse | null>();

/**
 * Resolve a REMOTE identity's slyng-VERIFIED current root key (P12), as a syr
 * client. The browser must never fetch the remote host's rotation chain and
 * trust its advertised `current_root` — a malicious host could dictate the
 * root. Instead we ask slyng's OWN backend (`/api/identity/remote-root`), which
 * fetches the remote `rotations` endpoint server-side and re-verifies the chain
 * (`verifyRotationChain`) before answering. The returned `current_root` is thus
 * always slyng-verified; `rotation_seq` is 0 for an un-rotated / unreachable
 * peer (backend fell back to the genesis key). A PUBLISHED chain that fails
 * verification is a HARD failure server-side: the backend returns a non-OK
 * response (never a genesis downgrade), which we map to `null` here — so a
 * tampered/forked chain leaves the caller with no verified root, never a false
 * "verified" badge.
 *
 * Verifying remote signed content or a remote root signature MUST resolve the
 * key through here, never the genesis key parsed from the DID.
 */
export async function resolveRemoteRoot(
	did: string,
	instanceUrl: string
): Promise<RemoteRootResponse | null> {
	const key = `${instanceUrl}::${did}`;
	if (rotationCache.has(key)) return rotationCache.get(key) ?? null;

	let result: RemoteRootResponse | null = null;
	try {
		// `/identity/remote-root` is authenticated — `@SkipServerAccess()` without
		// `@Public()`, and the handler calls `requireDid(req)`. A bare fetch
		// carries only the cookie, which a cross-site native webview will not
		// send once the cookie is SameSite=Lax; `idpFetch` adds the Bearer that
		// the native and WASM clients authenticate with everywhere else.
		//
		// It fails silently if it regresses: the catch below caches `null`, so
		// P12 root-key verification simply stops resolving with no error surfaced.
		const res = await idpFetch(
			`/identity/remote-root?did=${encodeURIComponent(did)}&instance=${encodeURIComponent(instanceUrl)}`,
			{ headers: { Accept: 'application/json' } }
		);
		if (res.ok) {
			const body = (await res.json()) as { data?: RemoteRootResponse };
			result = body.data ?? null;
		}
	} catch {
		result = null;
	}
	rotationCache.set(key, result);
	return result;
}

async function fetchAndCache(did: string, instanceUrl: string) {
	try {
		const manifest = await fetchManifest(did, instanceUrl);

		// `no-store`: this fetch only ever runs on a cache miss or after
		// invalidateProfile() (i.e. a PROFILE_UPDATE told us the profile
		// changed). The SvelteMap above is the real cache; the media proxy
		// stamps `Cache-Control: max-age=60` on every response, so without
		// this a post-invalidation re-fetch would serve the stale profile
		// JSON (old avatar_url/?v=) for up to a minute and the UI wouldn't
		// reflect the edit until the HTTP cache expired.
		const profileRes = await fetch(proxied(manifest.endpoints.profile), { cache: 'no-store' });
		if (!profileRes.ok) throw new Error('profile fetch failed');
		const body = (await profileRes.json()) as {
			data: {
				username?: string;
				display_name?: string;
				bio?: string;
				avatar_url?: string;
				banner_url?: string;
			};
		};

		cache.set(did, {
			did,
			instance_url: instanceUrl,
			username: body.data.username,
			display_name: body.data.display_name,
			bio: body.data.bio,
			avatar_url: body.data.avatar_url,
			banner_url: body.data.banner_url,
			web_profile_url: manifest.web_profile,
			loading: false
		});
	} catch {
		cache.set(did, { did, instance_url: instanceUrl, loading: false, error: true });
	} finally {
		inflight.delete(did);
	}
}

/**
 * Look up profile. Kicks off a background fetch if not cached.
 * Safe to call inside `$derived(...)` — all state mutations happen async
 * (in a microtask), never synchronously during the derived expression.
 */
export function resolveProfile(did: string, instanceUrl?: string): Profile {
	const cached = cache.get(did);
	if (cached) return cached;

	if (instanceUrl && !inflight.has(did)) {
		inflight.set(did, fetchAndCache(did, instanceUrl));
	}

	return { did, instance_url: instanceUrl ?? '', loading: !!instanceUrl };
}

export function getProfileFor(did: string, instanceUrl?: string): Profile {
	return resolveProfile(did, instanceUrl);
}

export function displayName(profile: Profile | undefined, fallbackDid: string): string {
	if (!profile) return fallbackDid.slice(0, 12);
	return profile.display_name || profile.username || fallbackDid.slice(0, 12);
}

export function federatedHandle(profile: Profile | undefined, fallbackDid: string): string {
	if (!profile) return fallbackDid.slice(0, 16);
	const name = profile.username ?? fallbackDid.slice(0, 12);
	const host = profile.instance_url ? instanceHost(profile.instance_url) : '';
	return host ? `${name}@${host}` : name;
}

/**
 * Drop a DID from caches so the next resolveProfile call re-fetches from the
 * user's syr instance. Called when the backend notifies us of a hash change.
 */
export function invalidateProfile(did: string) {
	cache.delete(did);
	inflight.delete(did);
	// Also blow the manifest + rotation-chain cache entries for this DID
	for (const key of manifestCache.keys()) {
		if (key.endsWith(`::${did}`)) manifestCache.delete(key);
	}
	for (const key of rotationCache.keys()) {
		if (key.endsWith(`::${did}`)) rotationCache.delete(key);
	}
}

// ── Federated watcher wiring ──

/**
 * Tell the slyng backend to watch these DIDs' hash endpoints on their
 * respective syr instances. Backend polls periodically and notifies via
 * PROFILE_UPDATE when anything changes.
 */
export function watchProfiles(profiles: { did: string; instance_url: string }[]) {
	if (!profiles.length) return;
	send({ op: WsOp.WATCH_PROFILES, d: { profiles } });
}

export function unwatchProfiles(dids: string[]) {
	if (!dids.length) return;
	send({ op: WsOp.UNWATCH_PROFILES, d: { dids } });
}

onWsEvent(WsOp.PROFILE_UPDATE, (raw) => {
	const d = raw as { did?: string };
	if (d?.did) invalidateProfile(d.did);
});
