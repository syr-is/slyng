import {
	Body,
	Controller,
	Delete,
	Get,
	HttpException,
	Param,
	Patch,
	Post,
	Query,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { FolderCreateDto, FolderUpdateDto, LibraryCompleteDto, LibraryPresignDto, ShareLinkDto, UploadPatchDto } from '../dto';
import { LibraryService } from './library.service';

/**
 * File-library endpoints for local accounts (P7). All owner routes live under
 * `/api/library/*` — a distinct namespace from the chat `uploads` controller
 * (`@Controller('uploads')`), which already owns `/api/uploads/*`. They're
 * authed but not server-scoped (@SkipServerAccess). The public federation list
 * (`GET /api/public/uploads/:did`) is served by IdpPublicController. Paths and
 * response shapes are adapted from syr's uploads/folders/storage-usage routes.
 */
@ApiTags('idp')
@Controller()
export class LibraryController {
	constructor(private readonly library: LibraryService) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	private ownParam(req: Request, didParam: string): string {
		const sessionDid = this.requireDid(req);
		if (decodeURIComponent(didParam) !== sessionDid) {
			throw new HttpException('You do not own this file', 403);
		}
		return sessionDid;
	}

	// ── Storage usage ───────────────────────────────────────────────────

	@SkipServerAccess()
	@Get('library/storage-usage')
	@ApiOperation({ summary: 'Current storage usage + quota for the caller' })
	async usage(@Req() req: Request) {
		const did = this.requireDid(req);
		const data = await this.library.usage(did);
		return { status: 'success', data };
	}

	// ── Folders ─────────────────────────────────────────────────────────

	@SkipServerAccess()
	@Get('library/folders')
	@ApiOperation({ summary: 'List folders under a parent (root when absent)' })
	async listFolders(@Req() req: Request, @Query('parent_id') parentId?: string) {
		const did = this.requireDid(req);
		const data = await this.library.listFolders(did, parentId || null);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Post('library/folders')
	@ApiOperation({ summary: 'Create a folder' })
	async createFolder(@Req() req: Request, @Body() body: FolderCreateDto) {
		const did = this.requireDid(req);
		const data = await this.library.createFolder(did, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Patch('library/folders/:id')
	@ApiOperation({ summary: 'Rename / move / re-scope a folder' })
	async updateFolder(@Req() req: Request, @Param('id') id: string, @Body() body: FolderUpdateDto) {
		const did = this.requireDid(req);
		const data = await this.library.updateFolder(did, decodeURIComponent(id), body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Delete('library/folders/:id')
	@ApiOperation({ summary: 'Delete a folder (delete_contents=true to cascade)' })
	async deleteFolder(
		@Req() req: Request,
		@Param('id') id: string,
		@Query('delete_contents') deleteContents?: string
	) {
		const did = this.requireDid(req);
		await this.library.deleteFolder(did, decodeURIComponent(id), deleteContents === 'true');
		return { status: 'success', data: { deleted: true } };
	}

	// ── Files ───────────────────────────────────────────────────────────

	@SkipServerAccess()
	@Get('library/files')
	@ApiOperation({ summary: "List the caller's library files (paginated)" })
	async listFiles(
		@Req() req: Request,
		@Query('folder_id') folderId?: string,
		@Query('search') search?: string,
		@Query('sort') sort?: string,
		@Query('order') order?: string,
		@Query('limit') limit?: string,
		@Query('offset') offset?: string
	) {
		const did = this.requireDid(req);
		const data = await this.library.listFiles(did, {
			// undefined = all folders; '' = root; value = that folder.
			folderId: folderId === undefined ? undefined : folderId,
			search: search || undefined,
			sort: sort || undefined,
			order: order === 'asc' ? 'asc' : 'desc',
			limit: this.clampInt(limit, 24, 1, 100),
			offset: Math.max(0, this.clampInt(offset, 0, 0, Number.MAX_SAFE_INTEGER))
		});
		return { status: 'success', ...data };
	}

	@SkipServerAccess()
	@Post('library/files/presign')
	@ApiOperation({ summary: 'Presigned PUT for a new library file' })
	async presign(@Req() req: Request, @Body() body: LibraryPresignDto) {
		const did = this.requireDid(req);
		const data = await this.library.presign(did, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Post('library/files/:id/complete')
	@ApiOperation({ summary: 'Finalize a library file after the S3 PUT succeeds' })
	async complete(@Req() req: Request, @Param('id') id: string, @Body() body: LibraryCompleteDto) {
		const did = this.requireDid(req);
		const data = await this.library.complete(did, id, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Patch('library/files/:did/:id')
	@ApiOperation({ summary: 'Rename / move / re-scope a library file' })
	async patch(
		@Req() req: Request,
		@Param('did') didParam: string,
		@Param('id') id: string,
		@Body() body: UploadPatchDto
	) {
		const did = this.ownParam(req, didParam);
		const data = await this.library.patch(did, id, body);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Delete('library/files/:did/:id')
	@ApiOperation({ summary: 'Delete a library file' })
	async remove(@Req() req: Request, @Param('did') didParam: string, @Param('id') id: string) {
		const did = this.ownParam(req, didParam);
		await this.library.remove(did, id);
		return { status: 'success', data: { deleted: true } };
	}

	@SkipServerAccess()
	@Post('library/files/:did/:id/share')
	@ApiOperation({ summary: 'Generate a time-boxed share link' })
	async share(
		@Req() req: Request,
		@Param('did') didParam: string,
		@Param('id') id: string,
		@Body() body: ShareLinkDto
	) {
		const did = this.ownParam(req, didParam);
		const data = await this.library.share(did, id, body?.expiresIn ?? 3600);
		return { status: 'success', data };
	}

	private clampInt(raw: string | undefined, fallback: number, lo: number, hi: number): number {
		const n = raw !== undefined ? parseInt(raw, 10) : NaN;
		if (Number.isNaN(n)) return fallback;
		return Math.min(hi, Math.max(lo, n));
	}
}
