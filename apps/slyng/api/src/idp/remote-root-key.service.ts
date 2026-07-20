import { Injectable, Logger } from '@nestjs/common';
import { verifyRotationChain, genesisKeyFromDid } from '@slyng/idp-crypto';
import type { RemoteRootResponse, RotationStatement } from '@slyng/types';
import { rootKeyMultibase } from './root-key.service';

const FETCH_TIMEOUT_MS = 6000;

/** Minimal shape of a remote identity manifest's endpoints we care about. */
interface RemoteIdentityManifest {
	endpoints?: { rotations?: string };
}

/**
 * Consuming-side trust anchor (P12): resolve a REMOTE `did:syr`'s CURRENT root
 * key from its published rotation chain, crypto-verified locally.
 *
 * Whenever slyng — acting as a syr CLIENT — verifies remote signed content or a
 * remote root signature, the key to verify against is the chain-resolved head,
 * NOT the genesis key parsed from the DID. This service fetches the identity
 * manifest to find the `rotations` endpoint, fetches the chain, and re-verifies
 * it here (`verifyRotationChain`) — it never trusts the remote's advertised
 * `current_root`. The browser calls the slyng backend for this (see the authed
 * `GET /api/identity/remote-root` route), so the viewer's IP never leaks to the
 * remote host and no untrusted head is ever believed client-side.
 *
 * Fallbacks, never a hard failure: a peer that advertises no `rotations`
 * endpoint, serves an empty chain, or is unreachable resolves to the genesis
 * (DID-derived) key — an un-rotated peer must still verify. A chain that fails
 * verification also falls back to genesis (an unverifiable head is not trusted).
 *
 * Server-side fetches use the same exempt plumbing as ProfileWatcher polls
 * (no browser, so no privacy proxy); the SSRF posture matches the existing
 * federation pollers.
 */
@Injectable()
export class RemoteRootKeyService {
	private readonly logger = new Logger(RemoteRootKeyService.name);

	/**
	 * The current root key (32 raw bytes) for a remote DID hosted at
	 * `instanceUrl`. Pass a pre-fetched `manifest` to skip the manifest round
	 * trip. Falls back to the genesis key on any absence/failure.
	 */
	async resolveCurrentRootKey(
		did: string,
		instanceUrl: string,
		manifest?: RemoteIdentityManifest
	): Promise<Uint8Array> {
		return (await this.resolve(did, instanceUrl, manifest)).key;
	}

	/**
	 * The slyng-verified current root of a remote DID as a wire response: the
	 * multibase key + the verified chain length (0 on genesis fallback). This is
	 * what the authed `remote-root` endpoint returns to the browser.
	 */
	async resolveCurrentRoot(
		did: string,
		instanceUrl: string,
		manifest?: RemoteIdentityManifest
	): Promise<RemoteRootResponse> {
		const { key, rotationSeq } = await this.resolve(did, instanceUrl, manifest);
		return { did, current_root: rootKeyMultibase(key), rotation_seq: rotationSeq };
	}

	/** Fetch + locally verify the remote chain; genesis fallback on any failure. */
	private async resolve(
		did: string,
		instanceUrl: string,
		manifest?: RemoteIdentityManifest
	): Promise<{ key: Uint8Array; rotationSeq: number }> {
		try {
			const rotationsUrl = manifest?.endpoints?.rotations
				? manifest.endpoints.rotations
				: await this.discoverRotationsUrl(did, instanceUrl);
			if (!rotationsUrl) return { key: genesisKeyFromDid(did), rotationSeq: 0 };

			const res = await fetch(rotationsUrl, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			if (!res.ok) return { key: genesisKeyFromDid(did), rotationSeq: 0 };

			const body = (await res.json()) as { data?: { chain?: RotationStatement[] } };
			const chain = body.data?.chain ?? [];
			if (chain.length === 0) return { key: genesisKeyFromDid(did), rotationSeq: 0 };

			// Re-verify locally — never trust the remote's `current_root`.
			return { key: verifyRotationChain(did, chain), rotationSeq: chain.length };
		} catch (err) {
			this.logger.warn(
				`remote root resolve failed for ${did.slice(0, 16)}… @ ${instanceUrl}: ` +
					`${(err as Error).message}; falling back to genesis`
			);
			return { key: genesisKeyFromDid(did), rotationSeq: 0 };
		}
	}

	/** Fetch the identity manifest and read its `rotations` endpoint, if any. */
	private async discoverRotationsUrl(did: string, instanceUrl: string): Promise<string | null> {
		const base = instanceUrl.replace(/\/+$/, '');
		const res = await fetch(`${base}/.well-known/syr/${encodeURIComponent(did)}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!res.ok) return null;
		const manifest = (await res.json()) as RemoteIdentityManifest;
		return manifest.endpoints?.rotations ?? null;
	}
}
