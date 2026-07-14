import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { buildDidDocument, isValidSyrDid, type DidDocument } from '@syren/idp-crypto';
import { extractDid, extractLocalId } from '@syren/types';
import type {
	PublicProfileData,
	PublicStoriesResponse,
	PublicStorySlide,
	SyrIdentityManifest,
	SyrInstanceManifest
} from '@syren/types';
import type { OwnedPost, PublicPostSummary, PublicPostsResponse } from '@syren/types';
import type { PublicEmoji, PublicEmojisResponse, PublicGif, PublicGifsResponse } from '@syren/types';
import type { PublicUpload, PublicUploadsResponse } from '@syren/types';
import {
	IdentityRepository,
	IdpProfileRepository,
	LocalAccountRepository,
	type LocalAccountRow,
	type ProfileRow
} from './idp.repository';
import { LibraryUploadRepository, type LibraryUploadRow } from './idp-content.repository';
import { PostRepository, type PostRow } from './idp-post.repository';
import {
	EmojiRepository,
	GifRepository,
	type EmojiRow,
	type GifRow
} from './idp-media.repository';

const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Clamp a pagination value into [lo, hi] (floored). */
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(n)));

/**
 * Public read surface of the local IdP: manifests, DID documents, public
 * profiles, and the change-detection hash — the endpoints a syr identity
 * manifest advertises. Response shapes are ports of syr's routes
 * (apps/syr/app/src/routes/.well-known/*, routes/api/public/*) and must
 * stay wire-compatible: syren's own federation stores consume them.
 */
@Injectable()
export class IdpPublicService {
	constructor(
		private readonly config: ConfigService,
		private readonly accounts: LocalAccountRepository,
		private readonly identities: IdentityRepository,
		private readonly profiles: IdpProfileRepository,
		private readonly uploads: LibraryUploadRepository,
		private readonly posts: PostRepository,
		private readonly emojis: EmojiRepository,
		private readonly gifs: GifRepository
	) {}

	getPublicUrl(): string {
		return this.config.get('PUBLIC_URL', 'http://localhost:5174').replace(/\/+$/, '');
	}

	buildInstanceManifest(): SyrInstanceManifest {
		const base = this.getPublicUrl();
		return {
			name: 'syr',
			public_url: base,
			api: {
				public_profile: `${base}/api/public/profile`,
				public_posts: `${base}/api/public/posts`,
				public_stories: `${base}/api/public/stories`,
				public_uploads: `${base}/api/public/uploads`,
				public_following: `${base}/api/public/following`,
				public_emojis: `${base}/api/public/emojis`,
				public_gifs: `${base}/api/public/gifs`
			},
			identity_manifest_template: `${base}/.well-known/syr/{did}`,
			platform: {
				consent: `${base}/auth/platform-consent`,
				token: `${base}/api/platform/token`,
				sign: `${base}/api/platform/sign`,
				challenge: `${base}/api/platform/challenge`,
				delegations: `${base}/api/platform/delegations`,
				revoke: `${base}/api/platform/revoke`
			},
			// Self-custody device flows syren implements (P10). syren signs
			// content server-side, so syr's device content-signing endpoints
			// (post_sign / sigil_handoff / registry_sign / export_*) are
			// intentionally absent — the schema marks them optional.
			syner: {
				independent_login_challenge: `${base}/api/auth/independent-login/challenge/{id}`,
				independent_login_verify: `${base}/api/auth/independent-login/verify`,
				delegation_challenge_payload: `${base}/api/platform/delegation-challenge/{id}/payload`,
				delegation_verify: `${base}/api/platform/delegation-verify`
			}
		};
	}

	async buildIdentityManifest(did: string): Promise<SyrIdentityManifest> {
		this.assertDid(did);
		const identity = await this.identities.findByDid(did);
		if (!identity) throw new HttpException('Identity not found', 404);

		const base = this.getPublicUrl();
		const encoded = encodeURIComponent(did);
		return {
			version: 1,
			did,
			provider: base,
			endpoints: {
				profile: `${base}/api/public/profile/${encoded}`,
				posts: `${base}/api/public/posts/${encoded}`,
				stories: `${base}/api/public/stories/${encoded}`,
				uploads: `${base}/api/public/uploads/${encoded}`,
				did_document: `${base}/api/identity/${encoded}/document`,
				public_following: `${base}/api/public/following/${encoded}`,
				public_emojis: `${base}/api/public/emojis/${encoded}`,
				public_gifs: `${base}/api/public/gifs/${encoded}`,
				public_comments: `${base}/api/public/comments/${encoded}`,
				public_reactions: `${base}/api/public/reactions/${encoded}`,
				public_hash: `${base}/api/public/hash/${encoded}`
			},
			web_profile: `${base}/u/${encoded}`
		};
	}

	async getDidDocument(did: string): Promise<DidDocument> {
		this.assertDid(did);
		const identity = await this.identities.findByDid(did);
		if (!identity) throw new HttpException('Identity not found', 404);
		return buildDidDocument({
			did: identity.did,
			publicKeyMultibase: identity.public_key,
			serviceEndpoint: this.getPublicUrl()
		});
	}

	/** Look up a local account + profile by DID or username. */
	async findAccountAndProfile(
		param: string
	): Promise<{ account: LocalAccountRow; profile: ProfileRow } | null> {
		const account = isValidSyrDid(param)
			? await this.accounts.findByDid(param)
			: await this.accounts.findByUsername(param);
		if (!account) return null;
		const profile = await this.profiles.findByAccountId(account.id);
		if (!profile) return null;
		return { account, profile };
	}

	/** Port of syr's GET /api/public/profile/[param]. */
	async getPublicProfile(param: string): Promise<PublicProfileData> {
		const found = await this.findAccountAndProfile(param);
		if (!found) throw new HttpException('Profile not found', 404);
		const { account, profile } = found;

		// Cache-buster on media URLs so federated clients don't serve stale images
		const updatedAt = profile.updated_at ? new Date(profile.updated_at) : null;
		const v = updatedAt ? `?v=${updatedAt.getTime()}` : '';
		return {
			did: account.did ?? null,
			username: account.username,
			display_name: profile.display_name,
			bio: profile.bio,
			avatar_url: profile.avatar_url ? `${profile.avatar_url}${v}` : profile.avatar_url,
			banner_url: profile.banner_url ? `${profile.banner_url}${v}` : profile.banner_url,
			identity_host_url: profile.identity_host_url ?? null,
			content_signature: profile.content_signature,
			signed_payload_json: profile.signed_payload_json,
			signing_device_public_key: profile.signing_device_public_key
		};
	}

	/**
	 * Change-detection digest, port of syr's GET /api/public/hash/[did].
	 * The parts array keeps syr's exact ordering/format; story, emoji, gif
	 * and post parts are wired up as their hosting phases land — until
	 * then they contribute their empty-state values, so the format never
	 * shifts under consumers.
	 */
	async getPublicHash(did: string): Promise<{
		did: string;
		hash: string;
		profile_updated_at: string | null;
		story_count: number;
		latest_story_at: string | null;
	}> {
		this.assertDid(did);
		const account = await this.accounts.findByDid(did);
		if (!account) throw new HttpException('Profile not found', 404);
		const profile = await this.profiles.findByAccountId(account.id);

		const since = new Date(Date.now() - STORY_WINDOW_MS);
		const activeStories = await this.uploads.findActiveStoriesByDid(did, since);
		const activeStoryCount = activeStories.length;
		const latestStoryTs = activeStories.reduce((max, u) => {
			const t = (u.published_at ? new Date(u.published_at) : new Date(u.updated_at)).getTime();
			return t > max ? t : max;
		}, 0);
		// Sorted per-story ids so any change to the set changes the hash.
		const storyIds = activeStories
			.map((u) => extractLocalId(u.id))
			.sort()
			.join(',');

		// Real emoji/gif digests (P6). Format matches syr's `e:${count}:${latest}`
		// / `g:${count}:${latest}` over the DID's completed (live) rows, so the
		// hash flips when an emoji/gif is added or removed.
		const [emojiDigestData, gifDigestData] = await Promise.all([
			this.emojis.digestByDid(did),
			this.gifs.digestByDid(did)
		]);
		const emojiDigest = `e:${emojiDigestData.count}:${emojiDigestData.latestUpdatedAt ?? ''}`;
		const gifDigest = `g:${gifDigestData.count}:${gifDigestData.latestUpdatedAt ?? ''}`;
		// Real post digest (P5). Format matches syr's `p:${count}:${latest}`;
		// syr filters status='published' (a typo — no such status), so its
		// digest is effectively always empty. We filter 'completed', so the
		// hash actually flips when a public post is published.
		const postDigestData = await this.posts.digestByDid(did);
		const postDigest = `p:${postDigestData.count}:${postDigestData.latestUpdatedAt ?? ''}`;

		const profileUpdatedAt = profile?.updated_at ? new Date(profile.updated_at) : null;
		const parts = [
			profileUpdatedAt?.toISOString() ?? '',
			profile?.content_signature ?? '',
			String(activeStoryCount),
			latestStoryTs ? new Date(latestStoryTs).toISOString() : '',
			storyIds,
			emojiDigest,
			gifDigest,
			postDigest
		];
		const hash = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);

		return {
			did,
			hash,
			profile_updated_at: profileUpdatedAt?.toISOString() ?? null,
			story_count: activeStoryCount,
			latest_story_at: latestStoryTs ? new Date(latestStoryTs).toISOString() : null
		};
	}

	/** Public 24h story reel — port of syr's GET /api/public/stories/[did]. */
	async getPublicStories(did: string): Promise<PublicStoriesResponse> {
		this.assertDid(did);
		const since = new Date(Date.now() - STORY_WINDOW_MS);
		const uploads = await this.uploads.findActiveStoriesByDid(did, since);
		const slides = uploads.map((u) => this.uploadToSlide(u));
		return { did, slides };
	}

	private uploadToSlide(u: LibraryUploadRow): PublicStorySlide {
		const meta = (u.metadata ?? {}) as Record<string, unknown>;
		const posInt = (v: unknown) =>
			typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
		const nonNegInt = (v: unknown) =>
			typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
		const publishedAt = u.published_at ? new Date(u.published_at) : new Date(u.updated_at);
		return {
			id: extractLocalId(u.id),
			mime_type: u.mime_type,
			url: u.url as string,
			published_at: publishedAt.toISOString(),
			width: posInt(meta.width),
			height: posInt(meta.height),
			duration_seconds: nonNegInt(meta.duration_seconds)
		};
	}

	/**
	 * Public post list — port of syr's GET /api/public/posts/[did]. Only
	 * public + completed posts. `full=true` returns the whole post (incl.
	 * `content`); the default (metadata) variant omits the heavy `content`.
	 */
	async getPublicPostsByDid(
		did: string,
		opts: { full?: boolean; limit?: number; offset?: number } = {}
	): Promise<PublicPostsResponse> {
		this.assertDid(did);
		const full = !!opts.full;
		const limit = clamp(opts.limit ?? (full ? 24 : 30), 1, 100);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const { data, total } = await this.posts.findPublicByDid(did, { limit, offset });
		return {
			did,
			posts: data.map((r) => this.postToPublic(r, !full)),
			pagination: { limit, offset, total, has_more: offset + data.length < total }
		};
	}

	/** Single public post — port of syr's GET /api/public/posts/[did]/[localId]. */
	async getPublicPost(did: string, localId: string): Promise<OwnedPost> {
		this.assertDid(did);
		const row = await this.posts.findByComposite(did, localId);
		if (!row || row.visibility !== 'public' || row.status !== 'completed') {
			throw new HttpException('Post not found', 404);
		}
		return this.postToPublic(row, false) as OwnedPost;
	}

	/** Map a stored post row to its public wire shape. `summary` drops `content`. */
	private postToPublic(row: PostRow, summary: boolean): OwnedPost | PublicPostSummary {
		const base: OwnedPost = {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			type: row.type,
			visibility: row.visibility,
			status: row.status,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
		if (row.title) base.title = row.title;
		if (row.description) base.description = row.description;
		if (row.type === 'blog') {
			if (row.content_type) base.content_type = row.content_type;
			if (!summary && row.content !== undefined) base.content = row.content;
		} else {
			base.media_urls = row.media_urls ?? [];
			if (row.display_mode) base.display_mode = row.display_mode;
		}
		if (row.content_signature) base.content_signature = row.content_signature;
		if (row.signed_payload_json) base.signed_payload_json = row.signed_payload_json;
		if (row.signing_device_public_key)
			base.signing_device_public_key = row.signing_device_public_key;
		// `content` is only ever set above when !summary, so `base` already
		// matches PublicPostSummary in the summary case.
		return base;
	}

	/**
	 * Public emoji list — port of syr's GET /api/public/emojis/[did]. Completed
	 * (live) emoji only, ordered by shortcode. Shape matches syren's emoji store.
	 */
	async getPublicEmojisByDid(
		did: string,
		opts: { limit?: number; offset?: number } = {}
	): Promise<PublicEmojisResponse> {
		this.assertDid(did);
		const limit = clamp(opts.limit ?? 100, 1, 100);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const { data, total } = await this.emojis.findPublicByDid(did, { limit, offset });
		return {
			data: data.map((r) => this.emojiToPublic(r)),
			pagination: { limit, offset, total, has_more: offset + data.length < total }
		};
	}

	private emojiToPublic(row: EmojiRow): PublicEmoji {
		return {
			shortcode: row.shortcode,
			url: row.url ?? '',
			is_sticker: row.is_sticker,
			did: extractDid(row.id),
			local_id: extractLocalId(row.id)
		};
	}

	/**
	 * Public GIF list — port of syr's GET /api/public/gifs/[did]. Completed GIFs
	 * only, newest first, with an optional tag `search`. Shape matches syren's
	 * gif store.
	 */
	async getPublicGifsByDid(
		did: string,
		opts: { limit?: number; offset?: number; search?: string } = {}
	): Promise<PublicGifsResponse> {
		this.assertDid(did);
		const limit = clamp(opts.limit ?? 20, 1, 100);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const { data, total } = await this.gifs.findPublicByDid(did, {
			limit,
			offset,
			search: opts.search
		});
		return {
			data: data.map((r) => this.gifToPublic(r)),
			pagination: { limit, offset, total, has_more: offset + data.length < total }
		};
	}

	private gifToPublic(row: GifRow): PublicGif {
		return {
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			url: row.url ?? '',
			thumbnail_url: row.thumbnail_url ?? null,
			tags: row.tags ?? [],
			size: row.size,
			mime_type: row.mime_type
		};
	}

	/**
	 * Public library files — port of syr's GET /api/public/uploads/[did]. Only
	 * public + completed files with a live URL (is_story=false), newest first.
	 * Library uploads deliberately don't feed `public_hash` (private-first).
	 */
	async getPublicUploadsByDid(
		did: string,
		opts: { limit?: number; offset?: number } = {}
	): Promise<PublicUploadsResponse> {
		this.assertDid(did);
		const limit = clamp(opts.limit ?? 24, 1, 100);
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));
		const [total, rows] = await Promise.all([
			this.uploads.countPublicByDid(did),
			this.uploads.findPublicByDidPage(did, { limit, offset })
		]);
		return {
			data: rows.map((r) => this.uploadToPublic(r)),
			pagination: { limit, offset, total, has_more: offset + rows.length < total }
		};
	}

	private uploadToPublic(row: LibraryUploadRow): PublicUpload {
		return {
			id: String(row.id),
			did: extractDid(row.id),
			local_id: extractLocalId(row.id),
			owner_id: extractDid(row.id),
			folder_id: row.folder_id ? String(row.folder_id) : null,
			filename: row.filename,
			mime_type: row.mime_type,
			size: row.size,
			url: (row.url as string) ?? '',
			status: row.status,
			is_public: !!row.is_public,
			created_at: new Date(row.created_at).toISOString(),
			updated_at: new Date(row.updated_at).toISOString()
		};
	}

	/** True when `did` belongs to a local account on this instance. */
	async isLocalDid(did: string): Promise<boolean> {
		if (!did.startsWith('did:syr:')) return false;
		return (await this.identities.findByDid(did)) !== null;
	}

	private assertDid(did: string): void {
		if (!did || !did.startsWith('did:syr:') || !isValidSyrDid(did)) {
			throw new HttpException('Invalid DID format. Must start with did:syr:', 400);
		}
	}
}
