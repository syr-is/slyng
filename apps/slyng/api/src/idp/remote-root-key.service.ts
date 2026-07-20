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
 * A published, non-empty remote rotation chain that FAILED cryptographic
 * verification (seq gap, fork, bad signature, non-genesis start, cross-DID
 * replay, decreasing rotatedAt, …). The resolver MUST fail closed on this — it
 * must NEVER downgrade to the genesis key. An identity typically rotates
 * BECAUSE its genesis key was compromised; silently trusting genesis after a
 * broken chain would "verify" content against the very key the identity retired.
 */
export class RemoteChainVerificationError extends Error {
	constructor(
		readonly did: string,
		cause: unknown
	) {
		super(
			`remote rotation chain for ${did.slice(0, 24)}… failed verification: ` +
				`${cause instanceof Error ? cause.message : String(cause)}`
		);
		this.name = 'RemoteChainVerificationError';
	}
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
 * Two outcomes, kept strictly apart:
 * - **Genesis fallback (soft):** a peer that advertises no `rotations` endpoint,
 *   serves an empty chain, or is unreachable resolves to the genesis
 *   (DID-derived) key — an un-rotated peer must still verify.
 * - **Hard failure (fail closed):** a NON-EMPTY chain that fails crypto
 *   verification throws `RemoteChainVerificationError`. It is NEVER downgraded
 *   to genesis — that would trust a key the identity provably rotated away from.
 *
 * Egress: the `rotations` URL advertised by a remote manifest is followed ONLY
 * when it lives on the same origin as the instance we were asked about. A
 * malicious manifest could otherwise point `endpoints.rotations` at an internal
 * address (cloud metadata, a localhost admin port) and turn this authed,
 * on-demand route into an SSRF primitive. Off-origin endpoints are refused (and
 * treated as "no chain", i.e. genesis) before any fetch is issued.
 */
@Injectable()
export class RemoteRootKeyService {
	private readonly logger = new Logger(RemoteRootKeyService.name);

	/**
	 * The current root key (32 raw bytes) for a remote DID hosted at
	 * `instanceUrl`. Pass a pre-fetched `manifest` to skip the manifest round
	 * trip. Genesis on absence/unreachability; THROWS
	 * `RemoteChainVerificationError` if a published chain fails verification.
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
	 * what the authed `remote-root` endpoint returns to the browser. THROWS
	 * `RemoteChainVerificationError` if a published chain fails verification.
	 */
	async resolveCurrentRoot(
		did: string,
		instanceUrl: string,
		manifest?: RemoteIdentityManifest
	): Promise<RemoteRootResponse> {
		const { key, rotationSeq } = await this.resolve(did, instanceUrl, manifest);
		return { did, current_root: rootKeyMultibase(key), rotation_seq: rotationSeq };
	}

	/**
	 * Fetch the remote chain and resolve the current root. Genesis fallback ONLY
	 * for the absent/empty/unreachable cases; a published non-empty chain that
	 * fails verification is a hard failure (never masked by genesis).
	 */
	private async resolve(
		did: string,
		instanceUrl: string,
		manifest?: RemoteIdentityManifest
	): Promise<{ key: Uint8Array; rotationSeq: number }> {
		const chain = await this.fetchChain(did, instanceUrl, manifest);

		// No chain published (absent endpoint / off-origin / unreachable / empty):
		// the peer is un-rotated, so the genesis key IS its current root. This is
		// the ONLY genesis fallback and it never masks a verification failure.
		if (!chain || chain.length === 0) {
			return { key: genesisKeyFromDid(did), rotationSeq: 0 };
		}

		// A PUBLISHED, non-empty chain must verify. `verifyRotationChain` throws on
		// any tamper/fork/seq-gap/cross-DID replay/bad signature — fail closed,
		// NEVER fall back to the (possibly compromised) genesis key.
		try {
			return { key: verifyRotationChain(did, chain), rotationSeq: chain.length };
		} catch (err) {
			this.logger.warn(
				`remote rotation chain for ${did.slice(0, 16)}… @ ${instanceUrl} failed ` +
					`verification: ${(err as Error).message}; failing closed (NOT genesis)`
			);
			throw new RemoteChainVerificationError(did, err);
		}
	}

	/**
	 * Fetch the remote rotation chain, or `null` when NONE can be safely obtained
	 * (absent `rotations` endpoint, off-origin endpoint, non-OK/unreachable
	 * response, malformed body). A `null` return means "no chain to verify" — a
	 * legitimate un-rotated peer — and is NEVER conflated with a verification
	 * failure (which throws in `resolve`).
	 */
	private async fetchChain(
		did: string,
		instanceUrl: string,
		manifest?: RemoteIdentityManifest
	): Promise<RotationStatement[] | null> {
		const originBase = this.originOf(instanceUrl);
		if (!originBase) return null;
		try {
			const rotationsUrl = manifest?.endpoints?.rotations
				? manifest.endpoints.rotations
				: await this.discoverRotationsUrl(did, originBase);
			if (!rotationsUrl) return null;

			// Egress guard (SSRF): the chain endpoint MUST live on the same origin
			// as the instance we were asked about. A remote manifest could otherwise
			// point `endpoints.rotations` at an internal address and make our authed
			// server-side fetch it. Refuse off-origin before issuing any request.
			if (!this.isSameOrigin(rotationsUrl, originBase)) {
				this.logger.warn(
					`remote rotations endpoint for ${did.slice(0, 16)}… is off-origin ` +
						`(${this.originOf(rotationsUrl) ?? 'unparseable'} ≠ ${originBase}); refusing to follow`
				);
				return null;
			}

			const res = await fetch(rotationsUrl, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});
			if (!res.ok) return null;

			const body = (await res.json()) as { data?: { chain?: RotationStatement[] } };
			return body.data?.chain ?? null;
		} catch (err) {
			this.logger.warn(
				`remote root chain fetch failed for ${did.slice(0, 16)}… @ ${instanceUrl}: ` +
					`${(err as Error).message}; treating as un-rotated (genesis)`
			);
			return null;
		}
	}

	/** Fetch the identity manifest and read its `rotations` endpoint, if any. */
	private async discoverRotationsUrl(did: string, originBase: string): Promise<string | null> {
		const res = await fetch(`${originBase}/.well-known/syr/${encodeURIComponent(did)}`, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!res.ok) return null;
		const manifest = (await res.json()) as RemoteIdentityManifest;
		return manifest.endpoints?.rotations ?? null;
	}

	/** Scheme+host+port origin of an http(s) URL, or null if unparseable/non-http(s). */
	private originOf(url: string): string | null {
		try {
			const u = new URL(url);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
			return u.origin;
		} catch {
			return null;
		}
	}

	/** True iff `url` parses to an http(s) URL whose origin equals `origin`. */
	private isSameOrigin(url: string, origin: string): boolean {
		const o = this.originOf(url);
		return o !== null && o === origin;
	}
}
