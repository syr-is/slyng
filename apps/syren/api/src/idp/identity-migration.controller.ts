import {
	Body,
	Controller,
	HttpException,
	Post,
	Req,
	Res,
	UploadedFile,
	UseGuards,
	UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { AuthService } from '../auth/auth.service';
import { IdentityExportService } from './identity-export.service';
import { IdentityImportService } from './identity-import.service';
import { IdentityExportDto, RegisterWithImportDto } from '../dto';

type AuthedRequest = Request & { user?: { did?: string } };

const SESSION_COOKIE = 'syren_session';
/** Max upload size for an import bundle — matches the media-proxy 100 MB cap. */
const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;

/**
 * Identity import / export (P11). Export streams a signed `.zip` of the
 * caller's owned content (password-gated: the root seed signs the bundle).
 * Import ingests such a bundle — either into a brand-new account
 * (register-with-import, an identity migration preserving the DID) or into the
 * caller's existing account (restore/merge your own backup).
 */
@ApiTags('identity')
@Controller()
export class IdentityMigrationController {
	constructor(
		private readonly exportService: IdentityExportService,
		private readonly importService: IdentityImportService,
		private readonly authService: AuthService
	) {}

	private setSessionCookie(res: Response, sessionId: string): void {
		res.cookie(SESSION_COOKIE, sessionId, {
			path: '/',
			httpOnly: true,
			secure: this.authService.isProduction(),
			sameSite: 'none',
			maxAge: 30 * 24 * 60 * 60 * 1000
		});
	}

	@SkipServerAccess()
	@Post('identity/export')
	@ApiOperation({ summary: 'Download a signed export bundle of your identity (password-gated)' })
	async export(
		@Req() req: AuthedRequest,
		@Body() body: IdentityExportDto,
		@Res({ passthrough: false }) res: Response
	) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		const { zip, filename } = await this.exportService.exportIdentity(did, body.password);
		res.setHeader('Content-Type', 'application/zip');
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		res.setHeader('Content-Length', String(zip.length));
		res.setHeader('Cache-Control', 'no-store');
		res.end(Buffer.from(zip));
	}

	@Public()
	@UseGuards(ThrottlerGuard)
	@Throttle({ default: { limit: 5, ttl: 60_000 } })
	@Post('auth/register-with-import')
	@ApiConsumes('multipart/form-data')
	@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BUNDLE_BYTES } }))
	@ApiOperation({ summary: 'Create a new account from an export bundle (identity migration)' })
	async registerWithImport(
		@Body() body: RegisterWithImportDto,
		@UploadedFile() file: Express.Multer.File | undefined,
		@Res({ passthrough: true }) res: Response
	) {
		if (!file?.buffer?.length) throw new HttpException('An identity bundle file is required', 400);
		const { did, sessionId, bridge, imported } = await this.importService.registerWithImport(
			new Uint8Array(file.buffer),
			body.username,
			body.password,
			body.invite_code
		);
		this.setSessionCookie(res, sessionId);
		return { bridge, did, imported };
	}

	@SkipServerAccess()
	@Post('identity/import')
	@ApiConsumes('multipart/form-data')
	@UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BUNDLE_BYTES } }))
	@ApiOperation({ summary: 'Restore/merge an export bundle into your current account' })
	async importIntoExisting(
		@Req() req: AuthedRequest,
		@UploadedFile() file: Express.Multer.File | undefined
	) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		if (!file?.buffer?.length) throw new HttpException('An identity bundle file is required', 400);
		return this.importService.importIntoExisting(did, new Uint8Array(file.buffer));
	}
}
