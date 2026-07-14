import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpException,
	Param,
	Post,
	Req
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { RegistryAddDto, RegistrySyncDto } from '../dto';
import { RegistryService } from './registry.service';

/**
 * Registry / discovery outbox endpoints for local accounts (P9). All authed but
 * not server-scoped (@SkipServerAccess). Managing registries enqueues outbox
 * jobs; `sync` takes the account password to root-sign + push the pending
 * hosting records server-side. Paths mirror syr's /api/identity/registries* and
 * /api/identity/outbox*.
 */
@ApiTags('idp')
@Controller()
export class RegistryController {
	constructor(private readonly registry: RegistryService) {}

	private requireDid(req: Request): string {
		const did = (req as Request & { user?: { did?: string } }).user?.did;
		if (!did) throw new HttpException('Not authenticated', 401);
		return did;
	}

	@SkipServerAccess()
	@Get('identity/registries')
	@ApiOperation({ summary: 'List the publication registries the caller announces to' })
	async list(@Req() req: Request) {
		return { status: 'success', data: await this.registry.listRegistries(this.requireDid(req)) };
	}

	@SkipServerAccess()
	@Post('identity/registries')
	@HttpCode(201)
	@ApiOperation({ summary: 'Add a publication registry (enqueues an announce job)' })
	async add(@Req() req: Request, @Body() body: RegistryAddDto) {
		const data = await this.registry.addRegistry(this.requireDid(req), body.registry_url);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Post('identity/registries/sync')
	@ApiOperation({ summary: 'Sign (password) + push all pending registry jobs' })
	async sync(@Req() req: Request, @Body() body: RegistrySyncDto) {
		const data = await this.registry.sync(this.requireDid(req), body.password);
		return { status: 'success', data };
	}

	@SkipServerAccess()
	@Delete('identity/registries/:id')
	@ApiOperation({ summary: 'Remove a registry (enqueues a signed takedown)' })
	async remove(@Req() req: Request, @Param('id') id: string) {
		await this.registry.removeRegistry(this.requireDid(req), decodeURIComponent(id));
		return { status: 'success', data: { removed: true } };
	}

	@SkipServerAccess()
	@Get('identity/outbox')
	@ApiOperation({ summary: "List the caller's outbox jobs" })
	async outbox(@Req() req: Request) {
		return { status: 'success', data: await this.registry.listOutbox(this.requireDid(req)) };
	}

	@SkipServerAccess()
	@Post('identity/outbox/:id/retry')
	@ApiOperation({ summary: 'Requeue a failed outbox job for redelivery' })
	async retry(@Req() req: Request, @Param('id') id: string) {
		await this.registry.retryJob(this.requireDid(req), decodeURIComponent(id));
		return { status: 'success', data: { requeued: true } };
	}

	@SkipServerAccess()
	@Post('identity/outbox/:id/cancel')
	@ApiOperation({ summary: 'Cancel an outbox job' })
	async cancel(@Req() req: Request, @Param('id') id: string) {
		await this.registry.cancelJob(this.requireDid(req), decodeURIComponent(id));
		return { status: 'success', data: { cancelled: true } };
	}
}
