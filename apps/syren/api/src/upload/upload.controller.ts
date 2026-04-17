import { Controller, Get, Post, Patch, Param, Body, Req, Res, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { UploadService } from './upload.service';

@ApiTags('uploads')
@Controller('uploads')
export class UploadController {
	constructor(private readonly uploads: UploadService) {}

	@Post('presign')
	@ApiOperation({ summary: 'Request a presigned URL for a direct S3 PUT upload' })
	async presign(
		@Body() body: { filename: string; mime_type: string; size: number; channel_id?: string; sha256?: string },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.uploads.requestPresign(userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Patch(':uploadId/finalize')
	@ApiOperation({ summary: 'Finalize a pending upload after the PUT completes' })
	async finalize(
		@Param('uploadId') uploadId: string,
		@Body() body: { sha256?: string; width?: number; height?: number },
		@Req() req: any
	) {
		const userId = req.user?.id;
		if (!userId) throw new HttpException('Unauthorized', 401);
		try {
			return await this.uploads.finalize(uploadId, userId, body);
		} catch (err) {
			throw new HttpException(err instanceof Error ? err.message : 'Failed', 400);
		}
	}

	@Get(':uploadId')
	@ApiOperation({ summary: 'Redirect to the underlying stored file' })
	async redirect(@Param('uploadId') uploadId: string, @Res() res: Response) {
		const record = await this.uploads.findById(uploadId);
		if (!record || record.status !== 'completed') {
			throw new HttpException('Upload not found', 404);
		}
		return res.redirect(302, record.url);
	}
}
