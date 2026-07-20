import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type { AegisBundle } from '@slyng/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Root-key rotation chain store (P12). One row per rotation statement; the
 * ordered set (seq 1..n) is a DID's rotation chain. Row fields mirror the
 * wire `RotationStatement` (v2) so a row round-trips to the public chain
 * endpoint and back.
 *
 * Persistence invariant: the current root is ALWAYS resolved by verifying the
 * chain (RootKeyService), never read from a stored column. The identity's
 * `public_key` column stays pinned to the genesis (DID-deriving) key.
 */
export interface IdentityRotationRow extends Record<string, unknown> {
	id: RecordId;
	did: string;
	seq: number;
	prev_root: string;
	new_root: string;
	rotated_at: string;
	signature: string;
	created_at: Date;
}

@Injectable()
export class IdentityRotationRepository extends BaseRepository<IdentityRotationRow> {
	protected tableName = 'identity_rotation';
	constructor(db: DbService) {
		super(db);
	}

	/** The ordered rotation chain (seq ASC) for a DID. */
	async findChainByDid(did: string): Promise<IdentityRotationRow[]> {
		const result = await this.db.query<[IdentityRotationRow[]]>(
			`SELECT * FROM identity_rotation WHERE did = $did ORDER BY seq ASC`,
			{ did }
		);
		return result[0] ?? [];
	}

	/**
	 * Atomically append a rotation statement and — for custodial (Aegis)
	 * rotations — re-wrap the identity's encrypted seed columns in ONE
	 * transaction, so the chain head and the stored seed can never diverge.
	 *
	 * The `(did, seq)` UNIQUE index makes a concurrent or replayed same-seq
	 * append fail here; the whole transaction rolls back (rollback protection
	 * at the DB tier, on top of the chain-prefix check the caller performs).
	 *
	 * The immutable `public_key` (genesis / DID-deriving key) is intentionally
	 * left untouched.
	 */
	async appendRotation(params: {
		did: string;
		seq: number;
		prevRoot: string;
		newRoot: string;
		rotatedAt: string;
		signature: string;
		now: Date;
		/** When present (custodial rotation), re-wrap the identity's Aegis seed. */
		rewrapAegis?: AegisBundle;
	}): Promise<void> {
		const { did, seq, prevRoot, newRoot, rotatedAt, signature, now, rewrapAegis } = params;
		const rewrapClause = rewrapAegis
			? `UPDATE identity SET
					aegis_salt = $salt, aegis_nonce = $nonce, aegis_ct = $ct, aegis_tag = $tag,
					aegis_kdf_mem = $mem, aegis_kdf_it = $it, aegis_kdf_par = $par
				 WHERE did = $did;`
			: '';
		await this.db.query(
			`BEGIN TRANSACTION;
			 CREATE identity_rotation CONTENT {
				 did: $did, seq: $seq, prev_root: $prevRoot, new_root: $newRoot,
				 rotated_at: $rotatedAt, signature: $signature, created_at: $now
			 };
			 ${rewrapClause}
			 COMMIT TRANSACTION;`,
			{
				did,
				seq,
				prevRoot,
				newRoot,
				rotatedAt,
				signature,
				now,
				...(rewrapAegis
					? {
							salt: rewrapAegis.salt,
							nonce: rewrapAegis.nonce,
							ct: rewrapAegis.ct,
							tag: rewrapAegis.tag,
							mem: rewrapAegis.kdf.mem,
							it: rewrapAegis.kdf.it,
							par: rewrapAegis.kdf.par
						}
					: {})
			}
		);
	}
}
