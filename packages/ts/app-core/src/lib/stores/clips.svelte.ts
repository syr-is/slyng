// Fetch layer + reactive state for the post editor's Klipy media picker (GIFs /
// stickers / clips / memes). Ported from pendi's clips-store.svelte.ts, trimmed
// for slyng: slyng IS the server, so there's no on-device "unavailable" mode —
// only `available` (the server has a Klipy key) matters. All feed/category/track
// calls go through the authed `/clips` proxy (`idpJson`); the Klipy key never
// reaches the browser. Page fetches are de-duped by a composite key (slyng's
// gifs.svelte.ts idiom) so an effect re-run or a double scroll-trigger never
// double-loads.
import type {
	ClipCategory,
	ClipCategoriesResponse,
	ClipFeedEntry,
	ClipFeedMode,
	ClipFeedResponse,
	ClipKind,
	ClipTrackRequest
} from '@slyng/types';
import { idpJson } from '../idp-fetch.js';

export interface ClipPage {
	entries: ClipFeedEntry[];
	page: number;
	hasNext: boolean;
}

class ClipsStore {
	/** False once the server reports no Klipy key — the picker shows a teach panel. */
	available = $state(true);
	/** Kinds Klipy reports healthy right now (gates the tabs); null until known. */
	aliveKinds = $state<ClipKind[] | null>(null);
	/** Masonry hints from Klipy. */
	gridMinWidth = $state<number | undefined>(undefined);
	adMaxResizePercent = $state<number | undefined>(undefined);

	#cats = new Map<ClipKind, ClipCategory[]>();
	#inflight = new Map<string, Promise<ClipPage | null>>();

	/** Fetch one page. De-duped by (kind,mode,q,page). Returns null on a transient
	 *  error (the picker shows a retry). */
	loadFeed(opts: {
		kind: ClipKind;
		mode: ClipFeedMode;
		q?: string;
		page: number;
	}): Promise<ClipPage | null> {
		const key = `${opts.kind}:${opts.mode}:${opts.q ?? ''}:${opts.page}`;
		const existing = this.#inflight.get(key);
		if (existing) return existing;
		const job = this.#fetch(opts);
		this.#inflight.set(key, job);
		void job.finally(() => this.#inflight.delete(key));
		return job;
	}

	async #fetch(opts: {
		kind: ClipKind;
		mode: ClipFeedMode;
		q?: string;
		page: number;
	}): Promise<ClipPage | null> {
		try {
			const qs = new URLSearchParams({
				kind: opts.kind,
				mode: opts.mode,
				page: String(opts.page)
			});
			if (opts.q) qs.set('q', opts.q);
			const lang = this.#lang();
			if (lang) qs.set('lang', lang);
			const dev = this.#device();
			if (dev.width != null) qs.set('w', String(dev.width));
			if (dev.deviceW != null) qs.set('dw', String(dev.deviceW));
			if (dev.deviceH != null) qs.set('dh', String(dev.deviceH));
			if (dev.dpr != null) qs.set('dpr', String(dev.dpr));

			const res = await idpJson<ClipFeedResponse>(`/clips/feed?${qs}`);
			this.available = res.available;
			if (res.aliveKinds) this.aliveKinds = res.aliveKinds;
			if (res.gridMinWidth) this.gridMinWidth = res.gridMinWidth;
			if (res.adMaxResizePercent != null) this.adMaxResizePercent = res.adMaxResizePercent;
			return { entries: res.entries, page: res.page, hasNext: res.hasNext };
		} catch {
			return null;
		}
	}

	async loadCategories(kind: ClipKind): Promise<ClipCategory[]> {
		const cached = this.#cats.get(kind);
		if (cached) return cached;
		try {
			const res = await idpJson<ClipCategoriesResponse>(
				`/clips/categories?kind=${encodeURIComponent(kind)}`
			);
			this.available = res.available;
			this.#cats.set(kind, res.categories);
			return res.categories;
		} catch {
			return [];
		}
	}

	/** Best-effort engagement signal Klipy expects (view on preview, share on pick). */
	track(req: ClipTrackRequest): void {
		void idpJson('/clips/track', { method: 'POST', body: JSON.stringify(req) }).catch(
			() => undefined
		);
	}

	#lang(): string | undefined {
		if (typeof navigator === 'undefined') return undefined;
		return navigator.language?.slice(0, 2) || undefined;
	}

	/** Viewport/screen hints so the server can fill Klipy's inline ad slots. */
	#device(): { width?: number; deviceW?: number; deviceH?: number; dpr?: number } {
		if (typeof window === 'undefined') return {};
		return {
			width: Math.min(window.innerWidth || 360, 480),
			deviceW: window.screen?.width,
			deviceH: window.screen?.height,
			dpr: window.devicePixelRatio
		};
	}
}

export const clips = new ClipsStore();
