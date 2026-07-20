import { Injectable } from '@nestjs/common';
import {
	verifyRotationChain,
	encodeMultibase,
	ED25519_MULTICODEC_PREFIX
} from '@slyng/idp-crypto';
import type { RotationChainResponse, RotationStatement } from '@slyng/types';
import { IdentityRotationRepository, type IdentityRotationRow } from './idp-rotation.repository';

/** Multibase-encode a raw 32-byte Ed25519 root public key (prefix + key). */
export function rootKeyMultibase(publicKey: Uint8Array): string {
	return encodeMultibase(new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...publicKey]));
}

/** Map a stored rotation row to its wire `RotationStatement`. */
export function rotationRowToStatement(row: IdentityRotationRow): RotationStatement {
	return {
		did: row.did,
		seq: row.seq,
		prevRoot: row.prev_root,
		newRoot: row.new_root,
		rotatedAt: row.rotated_at,
		signature: row.signature
	};
}

/**
 * Shared trust anchor for LOCAL identities (P12). Resolves the current root
 * key of a `did:syr` by verifying its stored rotation chain — genesis when the
 * chain is empty. Every place slyng verifies a ROOT signature for a local DID
 * (independent login, delegation-verify, DID-document building, rotation)
 * must resolve the key through here, never from a stored `public_key` column
 * that can drift from the chain.
 *
 * Remote identities are resolved against their fetched `rotations` endpoint,
 * not this service — see the consuming resolvers (ProfileWatcher, user
 * controller) which call `verifyRotationChain` on the fetched chain directly.
 */
@Injectable()
export class RootKeyService {
	constructor(private readonly rotations: IdentityRotationRepository) {}

	/** The ordered, wire-shaped rotation chain for a local DID. */
	async loadChain(did: string): Promise<RotationStatement[]> {
		const rows = await this.rotations.findChainByDid(did);
		return rows.map(rotationRowToStatement);
	}

	/**
	 * The current root public key (32 raw bytes), resolved from the VERIFIED
	 * chain (genesis when un-rotated). Throws if the stored chain fails
	 * validation — a chain this instance appended should always verify.
	 */
	async getCurrentRootKey(did: string): Promise<Uint8Array> {
		const chain = await this.loadChain(did);
		return verifyRotationChain(did, chain);
	}

	/** The current root as a multibase string (prefix + key). */
	async getCurrentRootMultibase(did: string): Promise<string> {
		return rootKeyMultibase(await this.getCurrentRootKey(did));
	}

	/** The highest seq in the chain (0 when un-rotated). */
	async getCurrentSeq(did: string): Promise<number> {
		return (await this.rotations.findChainByDid(did)).length;
	}

	/** The public rotation-chain response: ordered chain + verified head. */
	async getChainResponse(did: string): Promise<RotationChainResponse> {
		const chain = await this.loadChain(did);
		const key = verifyRotationChain(did, chain);
		return {
			did,
			current_root: rootKeyMultibase(key),
			rotation_seq: chain.length,
			chain
		};
	}
}
