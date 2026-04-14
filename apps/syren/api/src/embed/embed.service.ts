import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

interface EmbedData {
	title?: string;
	description?: string;
	url: string;
	thumbnail_url?: string;
	site_name?: string;
	embed_url?: string;
}

/**
 * Video platform embed URL resolvers.
 * Each entry: regex to match the URL, function to extract the embeddable iframe URL.
 */
const VIDEO_EMBED_RULES: { match: RegExp; embed: (m: RegExpExecArray) => string }[] = [
	// YouTube: watch, short, embed, live
	{
		match: /(?:youtube\.com\/(?:watch\?.*v=|embed\/|live\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
		embed: (m) => `https://www.youtube.com/embed/${m[1]}`
	},
	// Vimeo
	{
		match: /vimeo\.com\/(?:video\/)?(\d+)/,
		embed: (m) => `https://player.vimeo.com/video/${m[1]}`
	},
	// Dailymotion
	{
		match: /dailymotion\.com\/video\/([a-zA-Z0-9]+)/,
		embed: (m) => `https://www.dailymotion.com/embed/video/${m[1]}`
	},
	// Twitch clips
	{
		match: /clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/,
		embed: (m) => `https://clips.twitch.tv/embed?clip=${m[1]}&parent=${process.env.PUBLIC_HOSTNAME ?? 'localhost'}`
	},
	// Twitch VODs/channels
	{
		match: /twitch\.tv\/videos\/(\d+)/,
		embed: (m) => `https://player.twitch.tv/?video=${m[1]}&parent=${process.env.PUBLIC_HOSTNAME ?? 'localhost'}`
	},
	// Streamable
	{
		match: /streamable\.com\/([a-zA-Z0-9]+)/,
		embed: (m) => `https://streamable.com/e/${m[1]}`
	},
	// Kick clips
	{
		match: /kick\.com\/[^/]+\/clips\/([a-zA-Z0-9_-]+)/,
		embed: (m) => `https://kick.com/embed/clip/${m[1]}`
	}
];

function resolveVideoEmbed(url: string): string | undefined {
	for (const rule of VIDEO_EMBED_RULES) {
		const m = rule.match.exec(url);
		if (m) return rule.embed(m);
	}
	return undefined;
}

@Injectable()
export class EmbedService {
	constructor(private readonly db: DbService) {}

	/**
	 * Extract OpenGraph metadata from a URL.
	 * Checks cache first, fetches + caches on miss.
	 */
	async resolve(url: string): Promise<EmbedData | null> {
		const surreal = this.db.getDb();

		// Check cache
		const [cached] = await surreal.query<[{ data: EmbedData }[]]>(
			`SELECT data FROM url_embed_cache WHERE url = $url AND created_at > time::now() - 1h LIMIT 1`,
			{ url }
		);
		if (cached?.[0]) return cached[0].data;

		// Fetch and parse OG tags
		try {
			const response = await fetch(url, {
				headers: { 'User-Agent': 'Syren/1.0 (embed preview)' },
				signal: AbortSignal.timeout(5000),
				redirect: 'follow'
			});
			if (!response.ok) return null;

			const contentType = response.headers.get('content-type') || '';
			if (!contentType.includes('text/html')) return null;

			const html = await response.text();
			const embed = this.parseOgTags(html, url);

			if (embed.title || embed.description) {
				// Cache it
				await surreal.query(
					`UPSERT url_embed_cache SET
						url = $url,
						data = $data,
						created_at = time::now(),
						updated_at = time::now()
					WHERE url = $url`,
					{ url, data: embed }
				);
				return embed;
			}

			return null;
		} catch {
			return null;
		}
	}

	/**
	 * Extract URLs from message content and resolve embeds.
	 */
	async resolveFromContent(content: string): Promise<EmbedData[]> {
		const urlRegex = /https?:\/\/[^\s<>]+/g;
		const urls = content.match(urlRegex);
		if (!urls) return [];

		// Limit to first 3 URLs
		const unique = [...new Set(urls)].slice(0, 3);
		const results = await Promise.allSettled(
			unique.map((url) => this.resolve(url))
		);

		return results
			.filter((r): r is PromiseFulfilledResult<EmbedData | null> => r.status === 'fulfilled')
			.map((r) => r.value)
			.filter((r): r is EmbedData => r !== null);
	}

	private parseOgTags(html: string, url: string): EmbedData {
		const get = (property: string): string | undefined => {
			const regex = new RegExp(
				`<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
				'i'
			);
			const altRegex = new RegExp(
				`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
				'i'
			);
			return regex.exec(html)?.[1] || altRegex.exec(html)?.[1];
		};

		const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];

		return {
			title: get('og:title') || titleTag,
			description: get('og:description') || get('description'),
			url,
			thumbnail_url: get('og:image'),
			site_name: get('og:site_name'),
			embed_url: resolveVideoEmbed(url)
		};
	}
}
