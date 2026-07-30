import { Body, Controller, HttpException, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { RotationRequestDto } from '../dto';
import { RotationService } from './rotation.service';

/**
 * Root-key rotation (P12) — authenticated self-rotation of the caller's own
 * DID. Not server-scoped (@SkipServerAccess): rotation is an identity
 * operation, gated by the auth guard + possession (Aegis password or a
 * device-signed statement), not by a server permission flag. Rate-limited
 * because each attempt runs a KDF (Aegis mode).
 */
@ApiTags('idp')
@Controller()
@UseGuards(ThrottlerGuard)
export class RotationController {
	constructor(private readonly rotation: RotationService) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	@SkipServerAccess()
	@Throttle({ default: { limit: 5, ttl: 60_000 } })
	@Post('identity/rotate')
	@ApiOperation({ summary: 'Rotate the caller’s root key (mode: aegis | external)' })
	async rotate(@Req() req: Request, @Body() body: RotationRequestDto) {
		const did = this.requireDid(req);
		const data = await this.rotation.rotate(did, body);
		return { status: 'success', data };
	}
}
