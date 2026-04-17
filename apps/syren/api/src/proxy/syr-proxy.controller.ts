import { Controller, Get, Query, Req, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipServerAccess } from '../auth/server-access.decorator';
import type { Request } from 'express';

/**
 * Proxies authenticated GET requests to the user's syr instance using
 * their platform delegation token. Used by the syr-upload-picker to
 * fetch uploads cross-origin without exposing the session cookie.
 */
@ApiTags('syr-proxy')
@Controller('syr-proxy')
export class SyrProxyController {
	private readonly logger = new Logger(SyrProxyController.name);

	@Get()
	@SkipServerAccess()
	@ApiOperation({ summary: 'Proxy a GET request to the user\'s syr instance' })
	async proxy(@Query('path') path: string, @Req() req: Request) {
		const user = (req as any).user;
		if (!user?.syr_instance_url || !user?.platform_token) {
			throw new HttpException('No linked syr instance', HttpStatus.BAD_REQUEST);
		}

		if (!path || !path.startsWith('/api/')) {
			throw new HttpException('path must start with /api/', HttpStatus.BAD_REQUEST);
		}

		const base = user.syr_instance_url.replace(/\/+$/, '');
		const url = `${base}${path}`;

		try {
			const res = await fetch(url, {
				headers: {
					Authorization: `Bearer ${user.platform_token}`,
					Accept: 'application/json'
				},
				signal: AbortSignal.timeout(10000)
			});

			if (!res.ok) {
				return { error: `Upstream returned ${res.status}`, status: res.status };
			}

			return res.json();
		} catch (err) {
			this.logger.warn(`syr-proxy failed: ${err instanceof Error ? err.message : err}`);
			throw new HttpException('Failed to reach syr instance', HttpStatus.BAD_GATEWAY);
		}
	}
}
