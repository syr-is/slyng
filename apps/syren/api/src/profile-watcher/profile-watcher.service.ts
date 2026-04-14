import { Injectable, Inject, Optional, Logger, OnModuleInit, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WsOp } from '@syren/types';
import { ChatGateway } from '../gateway/chat.gateway';

interface WatchEntry {
	instance_url: string;
	hash_url: string | null;
	lastHash: string | null;
	refcount: number;
}

/**
 * Federated profile change watcher.
 *
 * Clients tell us which DIDs they're interested in (server members they're
 * currently looking at). We poll each DID's hash endpoint on the owning syr
 * instance on a fixed interval, with bounded concurrency so we never hammer
 * federated servers. When a hash changes, we broadcast PROFILE_UPDATE to all
 * connected clients so their profile/stories caches invalidate and re-fetch.
 *
 * The watch list is ref-counted: a DID gets watched once no matter how many
 * clients register it, and is evicted when the last watcher unregisters or
 * disconnects.
 */
@Injectable()
export class ProfileWatcherService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(ProfileWatcherService.name);

	// did → watch state
	private readonly watches = new Map<string, WatchEntry>();
	// client socket → set of dids it registered
	private readonly clientSubs = new Map<unknown, Set<string>>();

	// Concurrency-bounded polling — avoids a thundering herd when the
	// watch list is large
	private readonly MAX_CONCURRENT_POLLS = 8;
	private readonly POLL_TIMEOUT_MS = 6_000;

	constructor(@Optional() @Inject(forwardRef(() => ChatGateway)) private readonly gateway?: ChatGateway) {}

	onModuleInit() {
		this.logger.log('ProfileWatcher ready');
	}

	onModuleDestroy() {
		this.watches.clear();
		this.clientSubs.clear();
	}

	/** Register interest in a set of DIDs from a single client. */
	register(client: unknown, profiles: { did: string; instance_url: string }[]): void {
		let sub = this.clientSubs.get(client);
		if (!sub) {
			sub = new Set();
			this.clientSubs.set(client, sub);
		}
		for (const { did, instance_url } of profiles) {
			if (!did || !instance_url) continue;
			if (sub.has(did)) continue;
			sub.add(did);
			const existing = this.watches.get(did);
			if (existing) {
				existing.refcount += 1;
			} else {
				this.watches.set(did, { instance_url, hash_url: null, lastHash: null, refcount: 1 });
			}
		}
	}

	unregister(client: unknown, dids?: string[]): void {
		const sub = this.clientSubs.get(client);
		if (!sub) return;
		const toDrop = dids ?? [...sub];
		for (const did of toDrop) {
			if (!sub.delete(did)) continue;
			const entry = this.watches.get(did);
			if (!entry) continue;
			entry.refcount -= 1;
			if (entry.refcount <= 0) this.watches.delete(did);
		}
		if (sub.size === 0) this.clientSubs.delete(client);
	}

	/** Call this on client disconnect to free their watches. */
	forgetClient(client: unknown): void {
		this.unregister(client);
	}

	/** Main polling loop. 30s cadence — hash endpoint is deliberately cheap. */
	@Interval(30_000)
	async pollWatches(): Promise<void> {
		if (this.watches.size === 0) return;

		const entries = [...this.watches.entries()];
		const queue = [...entries];
		let inflight = 0;
		let changed = 0;

		await new Promise<void>((resolve) => {
			const drain = () => {
				while (inflight < this.MAX_CONCURRENT_POLLS && queue.length > 0) {
					const [did, entry] = queue.shift()!;
					inflight++;
					this.fetchHash(did, entry)
						.then((hash) => {
							if (!hash) return;
							// The entry may have been dropped mid-poll — check before mutating
							const live = this.watches.get(did);
							if (!live) return;
							if (live.lastHash !== null && live.lastHash !== hash) {
								changed++;
								this.gateway?.broadcastProfileUpdate(did);
							}
							live.lastHash = hash;
						})
						.catch((err) => {
							this.logger.debug(`hash poll failed did=${did.slice(0, 20)}: ${err instanceof Error ? err.message : err}`);
						})
						.finally(() => {
							inflight--;
							if (queue.length > 0) drain();
							else if (inflight === 0) resolve();
						});
				}
				if (queue.length === 0 && inflight === 0) resolve();
			};
			drain();
		});

		if (changed > 0) {
			this.logger.log(`profile hash changes: ${changed}/${entries.length}`);
		}
	}

	/** Resolve the hash endpoint URL from the identity manifest, with caching. */
	private async resolveHashUrl(did: string, entry: WatchEntry): Promise<string | null> {
		if (entry.hash_url) return entry.hash_url;
		const base = entry.instance_url.replace(/\/+$/, '');
		try {
			const res = await fetch(`${base}/.well-known/syr/${encodeURIComponent(did)}`, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(this.POLL_TIMEOUT_MS)
			});
			if (!res.ok) return null;
			const manifest = (await res.json()) as { endpoints?: { public_hash?: string } };
			const url = manifest.endpoints?.public_hash ?? null;
			if (url) entry.hash_url = url;
			return url;
		} catch {
			return null;
		}
	}

	private async fetchHash(did: string, entry: WatchEntry): Promise<string | null> {
		const hashUrl = await this.resolveHashUrl(did, entry);
		if (!hashUrl) return null;
		try {
			const res = await fetch(hashUrl, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(this.POLL_TIMEOUT_MS)
			});
			if (!res.ok) return null;
			const body = (await res.json()) as { data?: { hash?: string } };
			return body.data?.hash ?? null;
		} catch {
			return null;
		}
	}

	// Introspection for logs / debugging
	stats() {
		return {
			watchedDids: this.watches.size,
			clients: this.clientSubs.size
		};
	}
}
