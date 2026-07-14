import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type {
	ClipCategoriesResponse,
	ClipFeedMode,
	ClipFeedResponse,
	ClipKind,
	ClipTrackRequest
} from '@slyng/types';
import { KlipyProvider, type AdProfile } from './klipy.provider';

/**
 * Server-proxied GIF/sticker/clip/meme picker over Klipy (P5). Ported from
 * pendi's `clips.service.ts`. The provider holds the server-only key; this
 * service owns per-user identity (a stable `customer_id` + advertising id
 * derived from the caller's DID, so personalization / recents / ad
 * frequency-capping persist without exposing the raw DID) and shapes the typed
 * responses the client consumes. Availability is reported IN the response,
 * never via a separate capability call. With no key the picker simply reports
 * `available:false` and the UI degrades to a teach panel.
 */
@Injectable()
export class ClipsService {
	/** Klipy injects ~2 ads per page at fixed slots regardless of size, so a
	 *  modest page keeps a sane ad density while paging fast. */
	private static readonly PER_PAGE = 12;

	private readonly logger = new Logger(ClipsService.name);
	private readonly salt: string;
	private readonly mediaHosts: string[];

	constructor(
		private readonly klipy: KlipyProvider,
		config: ConfigService
	) {
		// `??` only falls back on null/undefined, but compose forwards these
		// optional vars as `${VAR:-}` — an EMPTY STRING when unset — so trim + `||`
		// so an empty value still picks up the default.
		const salt = config.get<string>('KLIPY_CUSTOMER_SALT')?.trim();
		this.salt = salt || 'slyng-klipy';
		if (this.klipy.available && !salt) {
			this.logger.warn(
				'KLIPY_CUSTOMER_SALT is unset — using a public default salt. Set a random value so the per-user Klipy id/ad-id cannot be precomputed from a DID.'
			);
		}
		this.mediaHosts = (config.get<string>('KLIPY_MEDIA_HOSTS')?.trim() || 'static.klipy.com')
			.split(',')
			.map((h) => h.trim().toLowerCase())
			.filter(Boolean);
	}

	get available(): boolean {
		return this.klipy.available;
	}

	async feed(
		userId: string,
		opts: { kind: ClipKind; mode: ClipFeedMode; q?: string; page: number },
		ad: AdProfile
	): Promise<ClipFeedResponse> {
		const page = Math.min(Math.max(1, Math.floor(opts.page) || 1), 100);
		if (!this.klipy.available) {
			return { entries: [], page, hasNext: false, available: false };
		}
		const aliveKinds = await this.klipy.aliveKinds(this.customerId(userId));
		const raw = await this.klipy.feed({
			kind: opts.kind,
			mode: opts.mode,
			q: opts.q,
			page,
			perPage: ClipsService.PER_PAGE,
			customerId: this.customerId(userId),
			ad: { ...ad, ifa: ad.ifa ?? this.advertisingId(userId) }
		});
		if (!raw) {
			// Transient upstream failure — stay available so the UI shows "try again"
			// rather than the missing-key teach panel.
			return { entries: [], page, hasNext: false, available: true, aliveKinds };
		}
		return {
			entries: raw.entries,
			page,
			hasNext: raw.hasNext,
			...(raw.gridMinWidth ? { gridMinWidth: raw.gridMinWidth } : {}),
			...(raw.adMaxResizePercent != null ? { adMaxResizePercent: raw.adMaxResizePercent } : {}),
			available: true,
			aliveKinds
		};
	}

	async categories(userId: string, kind: ClipKind): Promise<ClipCategoriesResponse> {
		if (!this.klipy.available) return { categories: [], available: false };
		const categories = (await this.klipy.categories(kind, this.customerId(userId))) ?? [];
		return { categories, available: true };
	}

	async track(userId: string, req: ClipTrackRequest): Promise<void> {
		await this.klipy.track(req.kind, req.slug, req.action, this.customerId(userId), req.reason);
	}

	async removeRecent(userId: string, kind: ClipKind, slug: string): Promise<void> {
		await this.klipy.removeRecent(kind, slug, this.customerId(userId));
	}

	/**
	 * Whether a `source:"klipy"` media URL points at an allowed Klipy CDN host.
	 * Lets a consumer reject an arbitrary URL smuggled in under the Klipy source.
	 * Defaults to `static.klipy.com`; override with KLIPY_MEDIA_HOSTS.
	 */
	isAllowedMediaUrl(url: string): boolean {
		try {
			const u = new URL(url);
			// https only — a cleartext CDN url is MITM-substitutable on render.
			if (u.protocol !== 'https:') return false;
			const host = u.hostname.toLowerCase();
			return this.mediaHosts.some((h) => host === h || host.endsWith(`.${h}`));
		} catch {
			return false;
		}
	}

	// ── Per-user identity (stable, opaque, never the raw DID) ───────────────────

	private customerId(userId: string): string {
		return this.uuidFrom(`${userId}:${this.salt}:customer`);
	}

	private advertisingId(userId: string): string {
		return this.uuidFrom(`${userId}:${this.salt}:ifa`);
	}

	/** Deterministic UUID-shaped id from a seed (stable across requests). */
	private uuidFrom(seed: string): string {
		const h = createHash('sha256').update(seed).digest('hex');
		return [
			h.slice(0, 8),
			h.slice(8, 12),
			h.slice(12, 16),
			h.slice(16, 20),
			h.slice(20, 32)
		].join('-');
	}
}
