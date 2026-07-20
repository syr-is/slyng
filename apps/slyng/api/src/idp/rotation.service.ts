import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
	generateRootKeypair,
	createRotationStatement,
	createAegisBundle,
	sign,
	encodeMultibase,
	verifyRotationChain
} from '@slyng/idp-crypto';
import type { AegisBundle, RotationRequest, RotationResult, RotationStatement } from '@slyng/types';
import { IdpAuditService } from './idp-audit.service';
import { IdpCryptoService } from './idp-crypto.service';
import { RegistryService } from './registry.service';
import { RootKeyService, rootKeyMultibase } from './root-key.service';
import { IdentityRotationRepository } from './idp-rotation.repository';
import {
	DelegatedKeyRepository,
	IdentityRepository,
	type IdentityRow
} from './idp.repository';

/**
 * Root-key rotation (P12). Retire the current root key of the caller's own
 * `did:syr` in favour of a successor, without changing the DID. Two modes:
 *
 * - `aegis` — the server holds the Aegis-encrypted root seed. The password
 *   unlocks it, a fresh root is minted, the successor statement is signed with
 *   the OLD key, then in one atomic step the chain row is appended and the
 *   stored seed is re-wrapped under the NEW root. Active delegations are
 *   re-signed under the new root and the hosting record is re-published.
 *
 * - `external` — the caller's device (Syner) produced a fully-formed,
 *   already-signed successor statement. The server only validates it against
 *   the stored chain (strict extension: seq = n+1, prevRoot = current root,
 *   valid signature) and appends it. No server-held keys are involved.
 *
 * The current root is always resolved from the VERIFIED chain (RootKeyService);
 * the identity's `public_key` column stays pinned to the genesis key.
 */
@Injectable()
export class RotationService {
	private readonly logger = new Logger(RotationService.name);

	constructor(
		private readonly identities: IdentityRepository,
		private readonly delegatedKeys: DelegatedKeyRepository,
		private readonly rotations: IdentityRotationRepository,
		private readonly rootKey: RootKeyService,
		private readonly crypto: IdpCryptoService,
		private readonly registry: RegistryService,
		private readonly audit: IdpAuditService
	) {}

	async rotate(did: string, req: RotationRequest): Promise<RotationResult> {
		const identity = await this.identities.findByDid(did);
		if (!identity) throw new HttpException('Identity not found', 404);

		if (req.mode === 'aegis') {
			if (!req.password) throw new HttpException('password is required for aegis rotation', 400);
			return this.rotateAegis(did, identity, req.password);
		}
		if (!req.statement) throw new HttpException('statement is required for external rotation', 400);
		return this.rotateExternal(did, identity, req.statement);
	}

	private hasAegisSeed(identity: IdentityRow): boolean {
		return !!(
			identity.aegis_salt &&
			identity.aegis_nonce &&
			identity.aegis_ct &&
			identity.aegis_tag
		);
	}

	// ── custodial (server-held seed) ──────────────────────────────────────

	private async rotateAegis(
		did: string,
		identity: IdentityRow,
		password: string
	): Promise<RotationResult> {
		if (!this.hasAegisSeed(identity)) {
			throw new HttpException(
				'This identity has no server-held seed — rotate from your device (mode=external).',
				400
			);
		}

		// Current chain state (verified — throws if the stored chain is corrupt).
		const chain = await this.rootKey.loadChain(did);
		const currentKey = verifyRotationChain(did, chain);
		const nextSeq = chain.length + 1;
		const prevRoot = rootKeyMultibase(currentKey);

		const bundle = this.crypto.aegisBundleFromIdentity(identity);

		// Validate the password up front (a wrong one fails the Aegis decrypt).
		try {
			await this.crypto.withSeed({ bundle, password, action: async () => undefined });
		} catch {
			throw new HttpException('Incorrect password', 401);
		}

		// Active (non-revoked, non-expired) delegations get re-signed under the
		// new root so they keep verifying against the current root directly.
		const activeDelegations = (
			await this.delegatedKeys.findPlatformDelegationsByDid(did)
		).filter(
			(d) => !d.revoked_at && !(d.expires_at && new Date() > new Date(d.expires_at))
		);

		const prepared = await this.crypto.withSeed({
			bundle,
			password,
			action: async (oldSeed) => {
				const newKeypair = await generateRootKeypair();
				try {
					const statement = await createRotationStatement(
						did,
						nextSeq,
						prevRoot,
						newKeypair.publicKey,
						oldSeed
					);
					const newBundle = await createAegisBundle(newKeypair.privateKey, password);
					const delegationSigs: Array<{ id: (typeof activeDelegations)[number]['id']; signature: string }> = [];
					for (const d of activeDelegations) {
						delegationSigs.push({
							id: d.id,
							signature: encodeMultibase(await sign(d.canonical_delegation, newKeypair.privateKey))
						});
					}
					return { statement, newBundle, delegationSigs };
				} finally {
					newKeypair.privateKey.fill(0);
				}
			}
		});

		// Self-check: the produced statement must extend the stored chain cleanly
		// (guards against an Aegis seed that no longer matches the chain head).
		try {
			verifyRotationChain(did, [...chain, prepared.statement]);
		} catch (err) {
			this.logger.error(
				`Aegis rotation for ${did.slice(0, 16)}… produced an invalid chain: ${(err as Error).message}`
			);
			throw new HttpException('Rotation aborted: server seed does not match the current root', 500);
		}

		// Atomic: append the chain row + re-wrap the identity's Aegis seed.
		await this.rotations.appendRotation({
			did,
			seq: nextSeq,
			prevRoot,
			newRoot: prepared.statement.newRoot,
			rotatedAt: prepared.statement.rotatedAt,
			signature: prepared.statement.signature,
			now: new Date(),
			rewrapAegis: prepared.newBundle as AegisBundle
		});

		// Re-sign active delegations under the new root (idempotent; a retired-root
		// delegation created before the rotation stays valid regardless).
		for (const { id, signature } of prepared.delegationSigs) {
			await this.delegatedKeys.merge(id, { signature });
		}

		await this.finishRotation(did, nextSeq, prepared.statement, 'aegis');
		return this.result(did, nextSeq, prepared.statement.newRoot);
	}

	// ── self-custody (device-held root) ───────────────────────────────────

	private async rotateExternal(
		did: string,
		identity: IdentityRow,
		statement: RotationStatement
	): Promise<RotationResult> {
		if (this.hasAegisSeed(identity)) {
			throw new HttpException(
				'This identity is password-custodied — rotate with mode=aegis so the server can re-wrap the seed.',
				400
			);
		}
		if (statement.did !== did) {
			throw new HttpException('Rotation statement is bound to a different DID', 400);
		}

		const chain = await this.rootKey.loadChain(did);
		const currentKey = verifyRotationChain(did, chain);
		const nextSeq = chain.length + 1;
		const prevRoot = rootKeyMultibase(currentKey);

		// Strict extension of the stored chain — rollback protection pins the
		// whole prefix, not just max seq. These are rotation-chain errors (409),
		// deliberately NOT reused with optimistic-concurrency "stale" messaging.
		if (statement.seq !== nextSeq) {
			throw new HttpException(
				`Rotation chain error: seq must be ${nextSeq} (strict extension of the current chain)`,
				409
			);
		}
		if (statement.prevRoot !== prevRoot) {
			throw new HttpException(
				'Rotation chain error: prevRoot does not match the current verified root',
				409
			);
		}

		// Full verification with the candidate appended: signature under prevRoot,
		// seq continuity, DID binding, non-decreasing rotatedAt.
		try {
			verifyRotationChain(did, [...chain, statement]);
		} catch (err) {
			throw new HttpException(`Rotation chain error: ${(err as Error).message}`, 409);
		}

		await this.rotations.appendRotation({
			did,
			seq: statement.seq,
			prevRoot: statement.prevRoot,
			newRoot: statement.newRoot,
			rotatedAt: statement.rotatedAt,
			signature: statement.signature,
			now: new Date()
			// No Aegis re-wrap and no server-side delegation re-signing: the root
			// key lives on the device. Server delegations created before the
			// rotation stay valid under the retired root (verifier rule); the
			// device re-issues them via the two-round delegation flow if desired.
		});

		await this.finishRotation(did, statement.seq, statement, 'external');
		return this.result(did, statement.seq, statement.newRoot);
	}

	// ── shared tail ───────────────────────────────────────────────────────

	private async finishRotation(
		did: string,
		seq: number,
		statement: RotationStatement,
		mode: 'aegis' | 'external'
	): Promise<void> {
		// Re-publish hosting records under the new root (enqueues outbox work).
		try {
			await this.registry.republishAfterRotation(did);
		} catch (err) {
			this.logger.warn(
				`Rotation re-publish enqueue failed for ${did.slice(0, 16)}…: ${(err as Error).message}`
			);
		}
		void this.audit.record({
			actorDid: did,
			action: 'identity_rotate',
			targetKind: 'identity',
			targetId: did,
			metadata: { seq, mode, new_root: statement.newRoot }
		});
		this.logger.log(`Rotated ${did.slice(0, 24)}… → seq ${seq} (${mode})`);
	}

	private result(did: string, seq: number, newRoot: string): RotationResult {
		return { did, rotation_seq: seq, current_root: newRoot, new_root: newRoot };
	}
}
