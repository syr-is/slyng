import {
	Body,
	Controller,
	Get,
	Header,
	HttpException,
	Param,
	Patch,
	Post,
	Query,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { IdpPublicService } from './idp-public.service';
import { ProfileService } from './profile.service';
import { FullProfilePatchDto, ProfileAssetPresignDto } from '../dto';

/**
 * Public identity endpoints under /api — the targets the per-DID manifest
 * advertises (profile, hash, DID document) plus the authed profile PATCH
 * for local accounts. Payload shapes are ports of syr's
 * routes/api/public/* — the `{ status: 'success', data }` envelope
 * included, since slyng's federation stores parse exactly that.
 */
@ApiTags('idp')
@Controller()
export class IdpPublicController {
	constructor(
		private readonly publicService: IdpPublicService,
		private readonly profileService: ProfileService
	) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	@Public()
	@Get('public/profile/:param')
	@ApiOperation({ summary: 'Public profile by DID or username' })
	async publicProfile(@Param('param') param: string) {
		const data = await this.publicService.getPublicProfile(decodeURIComponent(param));
		return { status: 'success', data };
	}

	@Public()
	@Get('public/uploads/:did')
	@Header('Cache-Control', 'public, max-age=30')
	@ApiOperation({ summary: 'Paginated public library files for a DID' })
	async publicUploads(
		@Param('did') did: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		const res = await this.publicService.getPublicUploadsByDid(decodeURIComponent(did), {
			limit: limit !== undefined ? parseInt(limit, 10) : undefined,
			offset: offset !== undefined ? parseInt(offset, 10) : undefined
		});
		return { status: 'success', ...res };
	}

	@Public()
	@Get('public/hash/:did')
	@Header('Cache-Control', 'public, max-age=5')
	@ApiOperation({ summary: 'Profile/content change-detection hash (polled by federated clients)' })
	async publicHash(@Param('did') did: string) {
		const data = await this.publicService.getPublicHash(decodeURIComponent(did));
		return { status: 'success', data };
	}

	@Public()
	@Get('identity/:did/document')
	@Header('Content-Type', 'application/did+ld+json')
	@Header('Cache-Control', 'public, max-age=300')
	@ApiOperation({ summary: 'DID document' })
	async didDocument(@Param('did') did: string) {
		return this.publicService.getDidDocument(decodeURIComponent(did));
	}

	@Public()
	@Get('identity/:did/rotations')
	@Header('Cache-Control', 'public, max-age=30')
	@ApiOperation({ summary: 'Ordered root-key rotation chain + verified current root' })
	async rotations(@Param('did') did: string) {
		const data = await this.publicService.getRotationChain(decodeURIComponent(did));
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Patch('user/profile')
	@ApiOperation({ summary: 'Update the local profile (local accounts only)' })
	async updateProfile(@Req() req: Request, @Body() body: FullProfilePatchDto) {
		const did = this.requireDid(req);
		const data = await this.profileService.updateProfile(did, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Post('user/profile-asset')
	@ApiOperation({ summary: 'Presigned PUT for an avatar/banner image' })
	async presignProfileAsset(@Req() req: Request, @Body() body: ProfileAssetPresignDto) {
		const did = this.requireDid(req);
		const data = await this.profileService.presignAsset(did, body);
		// Audit records the intent; the URL lands via the follow-up profile PATCH.
		await this.profileService.recordAssetUpdate(did, body.kind);
		return { status: 'success', data };
	}
}
