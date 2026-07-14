import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
	ClipCategory,
	ClipFeedEntry,
	ClipFeedMode,
	ClipItem,
	ClipKind
} from '@slyng/types';

/**
 * Klipy GIF/sticker/clip/meme provider. Ported near-verbatim from pendi's
 * `clips/providers/klipy.provider.ts`. Klipy's API key is a PATH SEGMENT
 * (`/api/v1/{KEY}/...`), so it is strictly server-only — this provider is the
 * single place it is ever used, and only resolved (CDN) URLs ever leave the
 * server. Read the key once via ConfigService, expose `available`, bound every
 * fetch with a timeout, and warn-and-degrade (return null) rather than throwing.
 *
 * Contract (validated against live responses + Klipy's official demo apps):
 *  - resource prefixes: gif→gifs, sticker→stickers, clip→clips, meme→static-memes
 *  - envelope: { result, data: { data[], has_next, meta:{ item_min_width,
 *    ad_max_resize_percent } } } — no total; page forward while has_next
 *  - ads are INLINE items with type:"ad" → { content:<iframe url>, width, height }
 *    (≈2 per page at fixed slots); detected purely by type, carry no slug
 *  - ads only fill when the FULL ad-* device-targeting set is sent
 *  - tracking: POST {prefix}/{view|share|report}/{slug} with { customer_id[,reason] }
 */

const DEFAULT_BASE = 'https://api.klipy.com/api/v1';

/**
 * Fallback User-Agent for Klipy requests. Klipy's ad exchange only fills its
 * inline ad slots for a realistic browser UA (a generic agent returns zero
 * ads) — verified against the live API. Feed requests forward the real browser
 * UA; this is the fallback for any request without one so ads still fill. The
 * user genuinely is on a browser, so this is faithful, not spoofing.
 */
const DEFAULT_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** ClipKind → Klipy resource prefix. */
const PREFIX: Record<ClipKind, string> = {
	gif: 'gifs',
	sticker: 'stickers',
	clip: 'clips',
	meme: 'static-memes'
};

/** Klipy item `type` → our ClipKind (authoritative over the requested kind). */
const TYPE_TO_KIND: Record<string, ClipKind> = {
	gif: 'gif',
	sticker: 'sticker',
	clip: 'clip',
	'static-meme': 'meme'
};

/** Ad targeting + identity profile. Ads only fill when this is reasonably
 *  complete, so missing fields fall back to a plausible mobile-web profile. */
export interface AdProfile {
	/** Container width → ad-max-width (so creatives fit the picker grid). */
	maxWidth?: number;
	deviceW?: number;
	deviceH?: number;
	dpr?: number;
	os?: string;
	osv?: string;
	make?: string;
	model?: string;
	/** locale + ad-language. */
	language?: string;
	/** Stable per-user advertising id (we derive it from the userId). */
	ifa?: string;
	/** Forwarded User-Agent header. */
	ua?: string;
}

type RawFormat = {
	url?: string;
	width?: number;
	height?: number;
	size?: number;
};
type RawTier = Record<string, RawFormat>;
interface RawItem {
	type?: string;
	slug?: string;
	title?: string;
	blur_preview?: string;
	// content gif/sticker/meme: tiered file (hd/md/sm/xs → format → {url,w,h})
	file?: Record<string, RawTier> | Record<string, string>;
	file_meta?: Record<string, { width?: number; height?: number }>;
	// clip: a top-level url too
	url?: string;
	// ad
	content?: string;
	width?: number;
	height?: number;
}

export interface RawFeed {
	entries: ClipFeedEntry[];
	hasNext: boolean;
	gridMinWidth?: number;
	adMaxResizePercent?: number;
}

@Injectable()
export class KlipyProvider {
	readonly id = 'klipy';
	private readonly logger = new Logger(KlipyProvider.name);
	private readonly key?: string;
	private readonly base: string;
	private health: { at: number; kinds: ClipKind[] } | null = null;

	constructor(config: ConfigService) {
		// The key is a URL PATH SEGMENT, so any stray whitespace/newline or wrapping
		// quotes from a pasted prod secret would silently 404 every request (the
		// picker shows empty tabs, not "not configured", since the key is still
		// truthy). Normalize defensively. Empty after trim → treated as unset.
		this.key =
			config
				.get<string>('KLIPY_WEB')
				?.trim()
				.replace(/^["']|["']$/g, '') || undefined;
		this.base = (config.get<string>('KLIPY_API_BASE')?.trim() || DEFAULT_BASE)
			.replace(/\/$/, '')
			.replace(/^["']|["']$/g, '');
	}

	/** True when a Klipy key is configured (else the picker shows a teach panel). */
	get available(): boolean {
		return !!this.key;
	}

	// ── Feed (trending / search / recent), with inline ads ─────────────────────

	async feed(opts: {
		kind: ClipKind;
		mode: ClipFeedMode;
		q?: string;
		page: number;
		perPage: number;
		customerId: string;
		ad: AdProfile;
	}): Promise<RawFeed | null> {
		if (!this.key) return null;
		const prefix = PREFIX[opts.kind];
		const params = this.adQuery(opts.customerId, opts.ad);
		params.set('page', String(opts.page));
		params.set('per_page', String(opts.perPage));

		let path: string;
		if (opts.mode === 'search') {
			params.set('q', opts.q ?? '');
			path = `${prefix}/search`;
		} else if (opts.mode === 'recent') {
			path = `${prefix}/recent/${encodeURIComponent(opts.customerId)}`;
		} else {
			path = `${prefix}/trending`;
		}

		const raw = await this.getJson<{
			data?: {
				data?: RawItem[];
				has_next?: boolean;
				meta?: { item_min_width?: number; ad_max_resize_percent?: number };
			};
		}>(`${path}?${params}`, opts.ad.ua);
		if (!raw?.data) return null;

		const entries: ClipFeedEntry[] = [];
		for (const it of raw.data.data ?? []) {
			const entry = this.normalize(it, opts.kind);
			if (entry) entries.push(entry);
		}
		return {
			entries,
			hasNext: !!raw.data.has_next,
			gridMinWidth: raw.data.meta?.item_min_width,
			adMaxResizePercent: raw.data.meta?.ad_max_resize_percent
		};
	}

	// ── Categories (no ads, no pagination) ─────────────────────────────────────

	async categories(kind: ClipKind, customerId: string): Promise<ClipCategory[] | null> {
		if (!this.key) return null;
		const raw = await this.getJson<{ data?: unknown }>(
			`${PREFIX[kind]}/categories?customer_id=${encodeURIComponent(customerId)}`
		);
		if (!raw) return null;
		const data = raw.data;
		// Live API returns { categories: [{category, query, preview_url}] }; the
		// older demo DTO returns a bare string[]. Handle both.
		const list: ClipCategory[] = [];
		const rows = Array.isArray(data)
			? data
			: ((data as { categories?: unknown[] })?.categories ?? []);
		for (const r of rows) {
			if (typeof r === 'string') {
				list.push({ label: r, query: r });
			} else if (r && typeof r === 'object') {
				const o = r as {
					category?: string;
					query?: string;
					preview_url?: string;
				};
				const query = o.query ?? o.category;
				if (!query) continue;
				list.push({
					label: o.category ?? query,
					query,
					...(o.preview_url ? { previewUrl: o.preview_url } : {})
				});
			}
		}
		return list;
	}

	// ── Tracking (best-effort; never throws to the caller) ─────────────────────

	async track(
		kind: ClipKind,
		slug: string,
		action: 'view' | 'share' | 'report',
		customerId: string,
		reason?: string
	): Promise<void> {
		if (!this.key || !slug) return;
		const body: Record<string, string> = { customer_id: customerId };
		if (action === 'report' && reason) body.reason = reason;
		await this.postJson(`${PREFIX[kind]}/${action}/${encodeURIComponent(slug)}`, body);
	}

	async removeRecent(kind: ClipKind, slug: string, customerId: string): Promise<void> {
		if (!this.key || !slug) return;
		await this.send(
			`${PREFIX[kind]}/recent/${encodeURIComponent(customerId)}?slug=${encodeURIComponent(slug)}`,
			{ method: 'DELETE' }
		);
	}

	/** Which kinds Klipy reports healthy (cached 5 min). Empty array on failure. */
	async aliveKinds(customerId: string): Promise<ClipKind[]> {
		if (!this.key) return [];
		const now = Date.now();
		if (this.health && now - this.health.at < 5 * 60_000) {
			return this.health.kinds;
		}
		const raw = await this.getJson<Record<string, { is_alive?: boolean }>>(
			`health-check?customer_id=${encodeURIComponent(customerId)}`
		);
		const data = (raw as { data?: Record<string, { is_alive?: boolean }> })?.data;
		const alive = data ?? (raw as Record<string, { is_alive?: boolean }>);
		const kinds: ClipKind[] = [];
		const check = (slug: string, kind: ClipKind) => {
			if (alive?.[slug]?.is_alive) kinds.push(kind);
		};
		check('gifs', 'gif');
		check('stickers', 'sticker');
		check('clips', 'clip');
		check('static-memes', 'meme');
		// If health-check is unreachable, don't hide the picker entirely — assume the
		// four kinds are usable and let individual requests degrade on their own.
		const result = kinds.length ? kinds : (['gif', 'sticker', 'clip', 'meme'] as ClipKind[]);
		this.health = { at: now, kinds: result };
		return result;
	}

	// ── Normalization ──────────────────────────────────────────────────────────

	private normalize(it: RawItem, requested: ClipKind): ClipFeedEntry | null {
		if (it.type === 'ad') {
			if (!it.content || !it.width || !it.height) return null;
			return {
				type: 'ad',
				ad: { url: it.content, width: it.width, height: it.height }
			};
		}
		const kind = (it.type && TYPE_TO_KIND[it.type]) || requested;
		if (!it.slug) return null;

		let item: ClipItem | null;
		if (kind === 'clip') item = this.normalizeClip(it, kind);
		else item = this.normalizeTiered(it, kind);
		if (!item) return null;
		return { type: 'content', item };
	}

	/** gif / sticker / meme: tiered `file` (hd/md/sm/xs → format → {url,w,h}). */
	private normalizeTiered(it: RawItem, kind: ClipKind): ClipItem | null {
		const file = it.file as Record<string, RawTier> | undefined;
		if (!file) return null;
		const display =
			this.pick(file, ['md', 'hd', 'sm', 'xs'], ['webp', 'gif']) ??
			this.pick(file, ['md', 'hd', 'sm', 'xs'], ['jpg']);
		const preview = this.pick(file, ['sm', 'xs', 'md', 'hd'], ['webp', 'gif']) ?? display;
		if (!display?.url || !preview?.url) return null;
		const mp4 = this.pick(file, ['md', 'hd', 'sm'], ['mp4']);
		return {
			kind,
			slug: it.slug!,
			...(it.title ? { title: it.title } : {}),
			url: display.url,
			previewUrl: preview.url,
			...(mp4?.url ? { mp4Url: mp4.url } : {}),
			width: display.width || preview.width || 200,
			height: display.height || preview.height || 200,
			...(it.blur_preview ? { blurPreview: it.blur_preview } : {})
		};
	}

	/** clip: single-file `file:{gif,mp4,webp}` (url strings) + `file_meta`. */
	private normalizeClip(it: RawItem, kind: ClipKind): ClipItem | null {
		const file = it.file as Record<string, string> | undefined;
		const mp4 = file?.mp4 ?? it.url;
		const preview = file?.webp ?? file?.gif ?? mp4;
		if (!mp4 || !preview) return null;
		const meta = it.file_meta ?? {};
		const dim = meta.mp4 ?? meta.webp ?? meta.gif ?? {};
		return {
			kind,
			slug: it.slug!,
			...(it.title ? { title: it.title } : {}),
			url: mp4,
			previewUrl: preview,
			mp4Url: mp4,
			width: dim.width || 200,
			height: dim.height || 200,
			...(it.blur_preview ? { blurPreview: it.blur_preview } : {})
		};
	}

	private pick(
		file: Record<string, RawTier>,
		tiers: string[],
		formats: string[]
	): RawFormat | null {
		for (const t of tiers) {
			const tier = file[t];
			if (!tier) continue;
			for (const f of formats) {
				const fmt = tier[f];
				if (fmt?.url) return fmt;
			}
		}
		return null;
	}

	// ── HTTP ───────────────────────────────────────────────────────────────────

	/** Build the shared ad/customer query, mirroring Klipy's official ad
	 *  interceptor. Ads only fill with a complete-enough device profile, so we
	 *  default the device fields to a plausible mobile-web profile. */
	private adQuery(customerId: string, ad: AdProfile): URLSearchParams {
		const lang = ad.language || 'en';
		const clamp = (v: number | undefined, lo: number, hi: number, def: number) =>
			Math.round(Math.min(hi, Math.max(lo, v || def)));
		const p = new URLSearchParams({
			customer_id: customerId,
			locale: lang,
			'ad-iframe': '1',
			'ad-min-width': '50',
			'ad-max-width': String(clamp(ad.maxWidth, 50, 1024, 360)),
			'ad-min-height': '50',
			'ad-max-height': '200',
			'ad-os': ad.os || 'Android',
			'ad-osv': ad.osv || '14',
			'ad-make': ad.make || 'Google',
			'ad-model': ad.model || 'Pixel',
			'ad-device-w': String(clamp(ad.deviceW, 1, 10000, 1080)),
			'ad-device-h': String(clamp(ad.deviceH, 1, 10000, 2400)),
			'ad-pxratio': String(clamp(ad.dpr, 1, 5, 2)),
			'ad-language': lang,
			'ad-app-version': '1.0'
		});
		if (ad.ifa) p.set('ad-ifa', ad.ifa);
		return p;
	}

	private url(path: string): string {
		return `${this.base}/${this.key}/${path}`;
	}

	private async getJson<T>(path: string, ua?: string): Promise<T | null> {
		const res = await this.send(path, { method: 'GET' }, ua);
		if (!res) return null;
		try {
			return (await res.json()) as T;
		} catch {
			return null;
		}
	}

	private async postJson(path: string, body: unknown): Promise<void> {
		await this.send(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	private async send(path: string, init: RequestInit, ua?: string): Promise<Response | null> {
		if (!this.key) return null;
		try {
			const headers = new Headers(init.headers);
			headers.set('User-Agent', ua || DEFAULT_UA);
			const res = await fetch(this.url(path), {
				...init,
				headers,
				redirect: 'follow',
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) {
				this.logger.warn(`Klipy ${init.method ?? 'GET'} ${path} → ${res.status}`);
				return null;
			}
			return res;
		} catch (err) {
			this.logger.warn(`Klipy request failed: ${(err as Error).message}`);
			return null;
		}
	}
}
