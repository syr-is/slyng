import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { canonicalize, encodeMultibase } from '@slyng/idp-crypto';
import type { OwnedOutboxJob, OwnedRegistry, RegistrySyncResult } from '@slyng/types';
import { IdpAuditService } from './idp-audit.service';
import { PlatformService } from './platform.service';
import { RootKeyService } from './root-key.service';
import {
	IdentityRepository,
	IdpProfileRepository,
	LocalAccountRepository
} from './idp.repository';
import {
	IdentityRegistryRepository,
	OutboxRepository,
	type IdentityRegistryRow,
	type OutboxRow
} from './idp-registry.repository';

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Registry/discovery outbox (P9). Announces "this DID is hosted here" to
 * external discovery registries via a root-signed hosting record.
 *
 * syr signs client-side (its server never holds the root key); slyng stores the
 * Aegis-encrypted root seed, so `sync(did, password)` decrypts it and signs
 * server-side — one endpoint instead of syr's four client paths. A signed job
 * carries a fixed `updatedAt`, so the `@Interval` poller can RE-DELIVER a
 * signed-but-undelivered job autonomously (no password) — something syr can't
 * do. The registry wire contract is byte-identical to syr's.
 */
@Injectable()
export class RegistryService {
	private readonly logger = new Logger(RegistryService.name);
	private delivering = false;

	constructor(
		private readonly config: ConfigService,
		private readonly registries: IdentityRegistryRepository,
		private readonly outbox: OutboxRepository,
		private readonly identities: IdentityRepository,
		private readonly accounts: LocalAccountRepository,
		private readonly profiles: IdpProfileRepository,
		private readonly platform: PlatformService,
		private readonly rootKey: RootKeyService,
		private readonly audit: IdpAuditService
	) {}

	private provider(): string {
		return this.config.get('PUBLIC_URL', 'http://localhost:5174').replace(/\/+$/, '');
	}

	/** Normalize a publication registry URL to its base (no trailing slash, no
	 * `/api/v1` — that's appended at push time; being forgiving avoids the
	 * double-prefix gotcha). */
	private normalizeRegistryUrl(raw: string): string {
		let url: URL;
		try {
			url = new URL(raw.trim());
		} catch {
			throw new HttpException('Invalid registry URL', 400);
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new HttpException('Registry URL must be http(s)', 400);
		}
		return `${url.origin}${url.pathname.replace(/\/(api\/v1\/?)?$/, '')}`.replace(/\/+$/, '');
	}

	// ── registry management ──

	async listRegistries(did: string): Promise<OwnedRegistry[]> {
		const rows = await this.registries.findByDid(did);
		return rows.map((r) => this.toOwnedRegistry(r));
	}

	async addRegistry(did: string, rawUrl: string): Promise<OwnedRegistry> {
		const url = this.normalizeRegistryUrl(rawUrl);
		if (await this.registries.findByDidAndUrl(did, url)) {
			throw new HttpException('Registry already added', 409);
		}
		const row = await this.registries.add(did, url);
		await this.outbox.enqueue({
			action: 'update',
			actorDid: did,
			registryUrl: url,
			provider: this.provider()
		});
		void this.audit.record({
			actorDid: did,
			action: 'registry_add',
			targetKind: 'registry',
			targetId: url
		});
		this.logger.log(`Registry added ${did.slice(0, 16)}… → ${url}`);
		return this.toOwnedRegistry(row);
	}

	async removeRegistry(did: string, id: string): Promise<void> {
		const rows = await this.registries.findByDid(did);
		const row = rows.find((r) => String(r.id) === id || String(r.id).endsWith(`:${id}`));
		if (!row) throw new HttpException('Registry not found', 404);
		// Enqueue a signed deletion (announces the takedown), then drop the local row.
		await this.outbox.enqueue({
			action: 'delete',
			actorDid: did,
			registryUrl: row.registry_url,
			provider: this.provider()
		});
		await this.registries.deleteByDidAndUrl(did, row.registry_url);
		void this.audit.record({
			actorDid: did,
			action: 'registry_remove',
			targetKind: 'registry',
			targetId: row.registry_url
		});
	}

	/**
	 * Re-publish a DID's hosting records after a root-key rotation (P12). The
	 * signed payload shape is unchanged (JCS over `{did, provider, updatedAt}`),
	 * but the signature must now be produced under the NEW current root: stale
	 * (old-root) signatures on pending jobs are cleared, every registry without an
	 * active update job gets a fresh one enqueued, and — when a `rootSign` for the
	 * new root is supplied (custodial/Aegis rotation, password in hand) — the
	 * jobs are RE-SIGNED here so the autonomous poller redelivers them without
	 * waiting for a future manual sync. Each delivered record carries the full
	 * `rotation_chain` (attached at push time), so a registry can resolve the new
	 * root from the genesis-anchored chain and verify the signature under it.
	 *
	 * External (device-held) rotations pass no signer — those jobs stay pending
	 * until the device syncs. Fire-and-forget: a rotation never fails on a
	 * republish hiccup.
	 */
	async republishAfterRotation(
		did: string,
		rootSign?: (statement: string) => Promise<Uint8Array>
	): Promise<void> {
		const registries = await this.registries.findByDid(did);
		if (registries.length === 0) return;

		const active = await this.outbox.activeByActor(did);
		const activeUpdateUrls = new Set(
			active.filter((j) => j.action === 'update').map((j) => j.registry_url)
		);
		await this.outbox.clearUpdateSignaturesForActor(did);
		for (const r of registries) {
			if (!activeUpdateUrls.has(r.registry_url)) {
				await this.outbox.enqueue({
					action: 'update',
					actorDid: did,
					registryUrl: r.registry_url,
					provider: this.provider()
				});
			}
			await this.registries.updateStatus(did, r.registry_url, 'pending');
		}

		// Custodial rotation: re-sign the (now unsigned) update jobs under the new
		// root immediately so `findDeliverable` picks them up autonomously.
		let reSigned = 0;
		if (rootSign) {
			const account = await this.accounts.findByDid(did);
			const profile = account ? await this.profiles.findByAccountId(account.id) : null;
			const username = account?.username ?? did.slice(0, 16);
			const displayName = profile?.display_name?.trim() || username;
			const jobs = await this.outbox.activeByActor(did);
			for (const job of jobs) {
				if (job.action !== 'update' || job.signature) continue;
				try {
					const fields = await this.signJob(job, rootSign, { username, displayName });
					await this.outbox.saveSignature(job.id, fields);
					reSigned++;
				} catch (err) {
					this.logger.warn(
						`Rotation re-sign failed for ${did.slice(0, 16)}… → ${job.registry_url}: ${(err as Error).message}`
					);
				}
			}
		}

		this.logger.log(
			`Rotation re-publish queued for ${did.slice(0, 16)}… (${registries.length} registries` +
				`${rootSign ? `, ${reSigned} re-signed under new root` : ''})`
		);
	}

	// ── outbox ──

	async listOutbox(did: string): Promise<OwnedOutboxJob[]> {
		const rows = await this.outbox.findByActor(did);
		return rows.map((r) => this.toOwnedJob(r));
	}

	async retryJob(did: string, id: string): Promise<void> {
		const job = await this.requireOwnJob(did, id);
		if (job.status === 'completed' || job.status === 'cancelled') {
			throw new HttpException('Job cannot be retried', 400);
		}
		await this.outbox.requeue(job.id);
	}

	async cancelJob(did: string, id: string): Promise<void> {
		const job = await this.requireOwnJob(did, id);
		if (job.status === 'completed') throw new HttpException('Job already completed', 400);
		await this.outbox.cancel(job.id);
	}

	private async requireOwnJob(did: string, id: string): Promise<OutboxRow> {
		const rows = await this.outbox.findByActor(did);
		const job = rows.find((r) => String(r.id) === id || String(r.id).endsWith(`:${id}`));
		if (!job) throw new HttpException('Outbox job not found', 404);
		return job;
	}

	// ── sync (server-side signing at password-in-hand) ──

	async sync(did: string, password: string): Promise<RegistrySyncResult> {
		const identity = await this.identities.findByDid(did);
		if (!identity) throw new HttpException('Identity not found', 404);
		const account = await this.accounts.findByDid(did);
		const profile = account ? await this.profiles.findByAccountId(account.id) : null;
		const username = account?.username ?? did.slice(0, 16);
		const displayName = profile?.display_name?.trim() || username;

		const rootSign = this.platform.createAegisRootSignFn(identity, password);
		// Validate the password once, up front (Aegis decrypt fails on a wrong one).
		try {
			await rootSign('slyng-registry-probe');
		} catch {
			throw new HttpException('Invalid password', 401);
		}

		let signed = 0;
		let delivered = 0;
		let failed = 0;
		const jobs = await this.outbox.activeByActor(did);
		for (const job of jobs) {
			if (!job.signature) {
				const fields = await this.signJob(job, rootSign, { username, displayName });
				await this.outbox.saveSignature(job.id, fields);
				Object.assign(job, fields);
				signed++;
			}
			try {
				await this.pushJob(job);
				await this.outbox.markCompleted(job.id);
				if (job.action === 'update') {
					await this.registries.updateStatus(did, job.registry_url, 'synced', new Date());
				}
				delivered++;
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'push failed';
				await this.outbox.markFailed(job.id, msg, job.attempts + 1, job.max_attempts);
				if (job.action === 'update') {
					await this.registries.updateStatus(did, job.registry_url, 'error');
				}
				failed++;
			}
		}

		void this.audit.record({
			actorDid: did,
			action: 'registry_sync',
			targetKind: 'registry',
			metadata: { signed, delivered, failed }
		});
		return { signed, delivered, failed, jobs: await this.listOutbox(did) };
	}

	/** Build + root-sign the canonical payload(s) for a job (syr-exact JCS). */
	private async signJob(
		job: OutboxRow,
		rootSign: (statement: string) => Promise<Uint8Array>,
		dir: { username: string; displayName: string }
	): Promise<Partial<OutboxRow>> {
		if (job.action === 'delete') {
			const deletedAt = new Date().toISOString();
			const sig = encodeMultibase(await rootSign(canonicalize({ did: job.did, deletedAt })));
			return { signature: sig, signed_deleted_at: deletedAt };
		}
		const updatedAt = new Date().toISOString();
		const hostingSig = encodeMultibase(
			await rootSign(canonicalize({ did: job.did, provider: job.provider, updatedAt }))
		);
		const listed = true;
		const dirSig = encodeMultibase(
			await rootSign(
				canonicalize({
					did: job.did,
					provider: job.provider,
					username: dir.username,
					displayName: dir.displayName,
					listed,
					updatedAt
				})
			)
		);
		return {
			signature: hostingSig,
			signed_updated_at: updatedAt,
			directory_signature: dirSig,
			dir_username: dir.username,
			dir_display_name: dir.displayName,
			dir_listed: listed
		};
	}

	/** POST a signed job to its registry. Throws on non-2xx (drives retry). */
	private async pushJob(job: OutboxRow): Promise<void> {
		const base = job.registry_url.replace(/\/+$/, '');
		if (job.action === 'delete') {
			await this.post(`${base}/api/v1/delete`, {
				did: job.did,
				deletedAt: job.signed_deleted_at,
				signature: job.signature
			});
			return;
		}
		// Carry the full rotation chain (empty for un-rotated identities). It is
		// genesis-anchored + self-verifying, so a registry resolves the CURRENT
		// root from it and verifies `signature` (produced under that current root)
		// against it — a rotated identity would otherwise fail verification against
		// the genesis key the DID embeds and silently drop out of the directory.
		const rotationChain = await this.rootKey.loadChain(job.did);
		await this.post(`${base}/api/v1/update`, {
			did: job.did,
			provider: job.provider,
			updatedAt: job.signed_updated_at,
			signature: job.signature,
			rotation_chain: rotationChain
		});
		// Directory upsert is best-effort — its failure never fails the job.
		if (job.directory_signature) {
			try {
				await this.post(`${base}/api/v1/directory/upsert`, {
					did: job.did,
					provider: job.provider,
					username: job.dir_username,
					displayName: job.dir_display_name,
					listed: job.dir_listed,
					updatedAt: job.signed_updated_at,
					signature: job.directory_signature
				});
			} catch (err) {
				this.logger.warn(
					`directory upsert failed for ${job.did.slice(0, 16)}… → ${base}: ${(err as Error).message}`
				);
			}
		}
	}

	private async post(url: string, body: unknown): Promise<void> {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
		if (!res.ok) {
			let detail = '';
			try {
				const j = (await res.json()) as { message?: string; code?: string };
				detail = j.code || j.message || '';
			} catch {
				/* ignore */
			}
			throw new Error(`${new URL(url).host} → ${res.status}${detail ? ` (${detail})` : ''}`);
		}
	}

	// ── autonomous redelivery poller ──

	/**
	 * Redeliver signed-but-undelivered jobs. No password needed: the signature
	 * over the fixed `updatedAt` is still valid, so the poller just re-pushes.
	 */
	async deliverPending(): Promise<void> {
		const jobs = await this.outbox.findDeliverable(20);
		for (const job of jobs) {
			try {
				await this.pushJob(job);
				await this.outbox.markCompleted(job.id);
				if (job.action === 'update') {
					await this.registries.updateStatus(job.actor_did, job.registry_url, 'synced', new Date());
				}
				this.logger.log(`Redelivered outbox job → ${job.registry_url}`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'push failed';
				await this.outbox.markFailed(job.id, msg, job.attempts + 1, job.max_attempts);
				if (job.action === 'update') {
					await this.registries.updateStatus(job.actor_did, job.registry_url, 'error');
				}
			}
		}
	}

	@Interval(60_000)
	async deliveryTick(): Promise<void> {
		if (this.delivering) return;
		this.delivering = true;
		try {
			await this.deliverPending();
		} catch (err) {
			this.logger.warn(`outbox delivery tick failed: ${(err as Error).message}`);
		} finally {
			this.delivering = false;
		}
	}

	// ── mappers ──

	private toOwnedRegistry(row: IdentityRegistryRow): OwnedRegistry {
		return {
			id: String(row.id),
			registry_url: row.registry_url,
			status: row.status,
			last_synced_at: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
			created_at: new Date(row.created_at).toISOString()
		};
	}

	private toOwnedJob(row: OutboxRow): OwnedOutboxJob {
		return {
			id: String(row.id),
			action: row.action,
			registry_url: row.registry_url,
			status: row.status,
			attempts: row.attempts,
			max_attempts: row.max_attempts,
			signed: !!row.signature,
			last_error: row.last_error ?? null,
			next_retry_at: row.next_retry_at ? new Date(row.next_retry_at).toISOString() : null,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
	}
}
