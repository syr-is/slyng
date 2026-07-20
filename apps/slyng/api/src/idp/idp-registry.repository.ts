import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import type { OutboxJobAction, OutboxJobStatus, RegistryStatus } from '@slyng/types';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

/**
 * Registry/discovery outbox repositories (P9). `identity_registry` holds the
 * publication registries a user announces to; `outbox` is the durable, retryable
 * queue of root-signed hosting-record pushes. Both are instance-local job/config
 * state (plain rows, hard-deleted) — ported from syr's identity_registry +
 * outbox tables (apps/syr/app/src/lib/repositories/{registry,outbox}.repository).
 */

export interface IdentityRegistryRow extends Record<string, unknown> {
	id: RecordId;
	identity_did: string;
	registry_url: string;
	status: RegistryStatus;
	last_synced_at?: Date | null;
	created_at: Date;
}

@Injectable()
export class IdentityRegistryRepository extends BaseRepository<IdentityRegistryRow> {
	protected tableName = 'identity_registry';
	constructor(db: DbService) {
		super(db);
	}

	async findByDid(did: string): Promise<IdentityRegistryRow[]> {
		const result = await this.db.query<[IdentityRegistryRow[]]>(
			`SELECT * FROM identity_registry WHERE identity_did = $did ORDER BY created_at ASC`,
			{ did }
		);
		return result[0] ?? [];
	}

	async findByDidAndUrl(did: string, url: string): Promise<IdentityRegistryRow | null> {
		return this.findOne({ identity_did: did, registry_url: url });
	}

	async add(did: string, url: string): Promise<IdentityRegistryRow> {
		return this.create({
			identity_did: did,
			registry_url: url,
			status: 'pending',
			last_synced_at: null,
			created_at: new Date()
		});
	}

	async updateStatus(
		did: string,
		url: string,
		status: RegistryStatus,
		lastSyncedAt?: Date | null
	): Promise<void> {
		const patch: Record<string, unknown> = { status };
		if (lastSyncedAt !== undefined) patch.last_synced_at = lastSyncedAt;
		await this.db.query(
			`UPDATE identity_registry SET status = $status${lastSyncedAt !== undefined ? ', last_synced_at = $lsa' : ''}
			 WHERE identity_did = $did AND registry_url = $url`,
			{ status, did, url, ...(lastSyncedAt !== undefined ? { lsa: lastSyncedAt } : {}) }
		);
	}

	async deleteByDidAndUrl(did: string, url: string): Promise<void> {
		await this.deleteWhere({ identity_did: did, registry_url: url });
	}
}

export interface OutboxRow extends Record<string, unknown> {
	id: RecordId;
	type: 'registry_sync';
	action: OutboxJobAction;
	actor_did: string;
	did: string;
	registry_url: string;
	provider: string;
	status: OutboxJobStatus;
	attempts: number;
	max_attempts: number;
	next_retry_at?: Date | null;
	last_error?: string | null;
	// Populated once signed (at a password-in-hand sync); enables autonomous
	// redelivery by the poller without re-signing.
	signature?: string;
	signed_updated_at?: string;
	signed_deleted_at?: string;
	directory_signature?: string;
	dir_username?: string;
	dir_display_name?: string;
	dir_listed?: boolean;
	created_at: Date;
	updated_at: Date;
}

const BASE_DELAY_MS = 5000;
const MAX_DELAY_MS = 3_600_000; // 1h — matches syr's cap.
const DEFAULT_MAX_ATTEMPTS = 10;

@Injectable()
export class OutboxRepository extends BaseRepository<OutboxRow> {
	protected tableName = 'outbox';
	constructor(db: DbService) {
		super(db);
	}

	async enqueue(params: {
		action: OutboxJobAction;
		actorDid: string;
		registryUrl: string;
		provider: string;
	}): Promise<OutboxRow> {
		const now = new Date();
		return this.create({
			type: 'registry_sync',
			action: params.action,
			actor_did: params.actorDid,
			did: params.actorDid,
			registry_url: params.registryUrl,
			provider: params.provider,
			status: 'pending',
			attempts: 0,
			max_attempts: DEFAULT_MAX_ATTEMPTS,
			next_retry_at: null,
			last_error: null,
			created_at: now,
			updated_at: now
		});
	}

	async findByActor(did: string): Promise<OutboxRow[]> {
		const result = await this.db.query<[OutboxRow[]]>(
			`SELECT * FROM outbox WHERE actor_did = $did ORDER BY created_at DESC`,
			{ did }
		);
		return result[0] ?? [];
	}

	/** Non-terminal jobs for a user — the sync target set (pending or failed). */
	async activeByActor(did: string): Promise<OutboxRow[]> {
		const result = await this.db.query<[OutboxRow[]]>(
			`SELECT * FROM outbox
			 WHERE actor_did = $did AND (status = 'pending' OR status = 'failed')
			 ORDER BY created_at ASC`,
			{ did }
		);
		return result[0] ?? [];
	}

	/**
	 * Already-signed jobs due for (re)delivery across all users — the poller's
	 * work set. Only jobs with a stored signature are redeliverable without the
	 * password; the fixed signed timestamp keeps the signature valid.
	 */
	async findDeliverable(limit = 20): Promise<OutboxRow[]> {
		const result = await this.db.query<[OutboxRow[]]>(
			`SELECT * FROM outbox
			 WHERE status = 'pending' AND signature != NONE
			   AND (next_retry_at IS NONE OR next_retry_at <= time::now())
			 ORDER BY created_at ASC LIMIT ${Math.max(1, Math.floor(limit))}`
		);
		return result[0] ?? [];
	}

	async findById(id: RecordId | string): Promise<OutboxRow | null> {
		const row = await this.db.select(this.toRecordId(id));
		return (row ?? null) as OutboxRow | null;
	}

	async saveSignature(
		id: RecordId | string,
		fields: Partial<
			Pick<
				OutboxRow,
				| 'signature'
				| 'signed_updated_at'
				| 'signed_deleted_at'
				| 'directory_signature'
				| 'dir_username'
				| 'dir_display_name'
				| 'dir_listed'
			>
		>
	): Promise<void> {
		await this.merge(id, { ...fields, updated_at: new Date() });
	}

	async markCompleted(id: RecordId | string): Promise<void> {
		await this.merge(id, {
			status: 'completed',
			last_error: null,
			next_retry_at: null,
			updated_at: new Date()
		});
	}

	/** Capped exponential backoff, matching syr: min(5s·2^attempts, 1h). */
	async markFailed(id: RecordId | string, error: string, attempts: number, maxAttempts: number): Promise<void> {
		const terminal = attempts >= maxAttempts;
		const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempts), MAX_DELAY_MS);
		await this.merge(id, {
			status: terminal ? 'failed' : 'pending',
			attempts,
			last_error: error.slice(0, 500),
			next_retry_at: terminal ? null : new Date(Date.now() + delay),
			updated_at: new Date()
		});
	}

	async cancel(id: RecordId | string): Promise<void> {
		await this.merge(id, { status: 'cancelled', next_retry_at: null, updated_at: new Date() });
	}

	/**
	 * Invalidate the stored (old-root) signatures on a DID's non-terminal
	 * `update` jobs and re-arm them as pending — used after a root rotation so
	 * the hosting record re-signs under the NEW root at the next sync, and the
	 * autonomous poller never redelivers an old-root-signed record.
	 */
	async clearUpdateSignaturesForActor(did: string): Promise<void> {
		await this.db.query(
			`UPDATE outbox SET
				signature = NONE, signed_updated_at = NONE, directory_signature = NONE,
				status = 'pending', attempts = 0, next_retry_at = NONE, last_error = NONE,
				updated_at = time::now()
			 WHERE actor_did = $did AND action = 'update'
			   AND status != 'completed' AND status != 'cancelled'`,
			{ did }
		);
	}

	async requeue(id: RecordId | string): Promise<void> {
		await this.merge(id, {
			status: 'pending',
			last_error: null,
			next_retry_at: new Date(),
			updated_at: new Date()
		});
	}
}
