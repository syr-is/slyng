import { Injectable, Logger } from '@nestjs/common';
import { verifyRotationChain, genesisKeyFromDid } from '@slyng/idp-crypto';
import type { RotationStatement } from '@slyng/types';

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
 * `current_root`.
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
		try {
			const rotationsUrl = manifest?.endpoints?.rotations
				? manifest.endpoints.rotations
				: await this.discoverRotationsUrl(did, instanceUrl);
			if (!rotationsUrl) return genesisKeyFromDid(did);

			const res = await fetch(rotationsUrl, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			if (!res.ok) return genesisKeyFromDid(did);

			const body = (await res.json()) as { data?: { chain?: RotationStatement[] } };
			const chain = body.data?.chain ?? [];
			if (chain.length === 0) return genesisKeyFromDid(did);

			// Re-verify locally — never trust the remote's `current_root`.
			return verifyRotationChain(did, chain);
		} catch (err) {
			this.logger.warn(
				`remote root resolve failed for ${did.slice(0, 16)}… @ ${instanceUrl}: ` +
					`${(err as Error).message}; falling back to genesis`
			);
			return genesisKeyFromDid(did);
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
