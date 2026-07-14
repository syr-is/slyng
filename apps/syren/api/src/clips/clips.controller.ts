import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Headers,
	HttpCode,
	HttpException,
	Post,
	Query,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
	ClipFeedMode,
	ClipKind,
	ClipTrackRequest,
	type ClipCategoriesResponse,
	type ClipFeedResponse
} from '@syren/types';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { ClipsService } from './clips.service';
import type { AdProfile } from './klipy.provider';

/**
 * Proxy for the Klipy-backed media picker (GIFs / stickers / clips / memes)
 * used by the post editor. The Klipy key never leaves the server; the browser
 * only ever talks to these routes. Authed (global AuthGuard) but not
 * server-scoped (@SkipServerAccess), since there's no serverId. Device hints
 * (w/dw/dh/dpr + User-Agent) are forwarded so Klipy fills its inline ad
 * slots — they have no effect on which content is returned.
 */
@ApiTags('clips')
@Controller('clips')
export class ClipsController {
	constructor(private readonly clips: ClipsService) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	@SkipServerAccess()
	@Get('feed')
	@ApiOperation({ summary: 'Klipy feed (trending / search / recent) with inline ads' })
	feed(
		@Req() req: Request,
		@Headers('user-agent') ua: string | undefined,
		@Query('kind') kind?: string,
		@Query('mode') mode?: string,
		@Query('q') q?: string,
		@Query('page') page?: string,
		@Query('lang') lang?: string,
		@Query('w') w?: string,
		@Query('dw') dw?: string,
		@Query('dh') dh?: string,
		@Query('dpr') dpr?: string
	): Promise<ClipFeedResponse> {
		const userId = this.requireDid(req);
		const k = ClipKind.safeParse(kind);
		if (!k.success) throw new BadRequestException('Unknown clip kind');
		const m = mode
			? ClipFeedMode.safeParse(mode)
			: { success: true as const, data: 'trending' as const };
		if (!m.success) throw new BadRequestException('Unknown feed mode');
		const query = (q ?? '').trim().slice(0, 100);
		if (m.data === 'search' && query.length < 1) {
			// Empty search short-circuits to nothing — the picker shows trending
			// until the user actually types.
			return Promise.resolve({
				entries: [],
				page: 1,
				hasNext: false,
				available: this.clips.available
			});
		}
		const ad: AdProfile = {
			...(ua ? { ua } : {}),
			...(lang ? { language: lang } : {}),
			...(num(w) ? { maxWidth: num(w) } : {}),
			...(num(dw) ? { deviceW: num(dw) } : {}),
			...(num(dh) ? { deviceH: num(dh) } : {}),
			...(num(dpr) ? { dpr: num(dpr) } : {})
		};
		return this.clips.feed(userId, { kind: k.data, mode: m.data, q: query, page: num(page) ?? 1 }, ad);
	}

	@SkipServerAccess()
	@Get('categories')
	@ApiOperation({ summary: 'Klipy browse categories for a kind' })
	categories(@Req() req: Request, @Query('kind') kind?: string): Promise<ClipCategoriesResponse> {
		const userId = this.requireDid(req);
		const k = ClipKind.safeParse(kind);
		if (!k.success) throw new BadRequestException('Unknown clip kind');
		return this.clips.categories(userId, k.data);
	}

	/** Fire-and-forget Klipy engagement signal (view on preview, share on pick). */
	@SkipServerAccess()
	@Post('track')
	@HttpCode(204)
	@ApiOperation({ summary: 'Track a Klipy view / share / report' })
	async track(@Req() req: Request, @Body() body: unknown): Promise<void> {
		const userId = this.requireDid(req);
		const parsed = ClipTrackRequest.safeParse(body);
		if (!parsed.success) throw new BadRequestException(parsed.error.issues);
		await this.clips.track(userId, parsed.data);
	}

	@SkipServerAccess()
	@Delete('recent')
	@HttpCode(204)
	@ApiOperation({ summary: 'Remove an item from the caller’s Klipy recents' })
	async removeRecent(
		@Req() req: Request,
		@Query('kind') kind?: string,
		@Query('slug') slug?: string
	): Promise<void> {
		const userId = this.requireDid(req);
		const k = ClipKind.safeParse(kind);
		if (!k.success) throw new BadRequestException('Unknown clip kind');
		if (!slug) throw new BadRequestException('slug required');
		await this.clips.removeRecent(userId, k.data, slug);
	}
}

function num(v?: string): number | undefined {
	if (v == null) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}
