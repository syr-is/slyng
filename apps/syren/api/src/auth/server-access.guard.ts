import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
	Logger
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { stringToRecordId } from '@syren/types';
import { MemberAccessService } from './member-access.service';
import { ChannelRepository } from '../channel/channel.repository';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SKIP_SERVER_ACCESS_KEY } from './server-access.decorator';

/**
 * Blocks banned users and non-members from reading ANY server-scoped HTTP
 * endpoint (channels, messages, members, roles, voice-states, invites list,
 * etc.). Authentication is assumed to be handled by `AuthGuard` first.
 *
 * Scope resolution:
 *  - route param `:serverId`              → direct
 *  - route param `:channelId`             → resolve via channel's server_id
 *  - anything else                        → pass through (not server-scoped)
 *
 * Skip via `@Public()` or `@SkipServerAccess()` on public / pre-membership
 * endpoints (invite preview + join, `/servers/@me`, server create, etc.).
 */
@Injectable()
export class ServerAccessGuard implements CanActivate {
	private readonly logger = new Logger(ServerAccessGuard.name);

	constructor(
		private readonly reflector: Reflector,
		private readonly access: MemberAccessService,
		private readonly channels: ChannelRepository
	) {}

	async canActivate(ctx: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			ctx.getHandler(),
			ctx.getClass()
		]);
		if (isPublic) return true;

		const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SERVER_ACCESS_KEY, [
			ctx.getHandler(),
			ctx.getClass()
		]);
		if (skip) return true;

		const req = ctx.switchToHttp().getRequest();
		const userId = req?.user?.id;
		if (!userId) return false; // AuthGuard should have rejected already

		const params = req?.params ?? {};
		let serverId: string | undefined = params.serverId;
		if (!serverId && params.channelId) {
			const channel = await this.channels.findById(params.channelId);
			if (!channel) throw new ForbiddenException('Channel not found');
			const sid = (channel as any).server_id;
			if (sid) serverId = stringToRecordId.encode(sid);
		}
		if (!serverId) return true; // route not server-scoped

		if (await this.access.isBanned(userId, serverId)) {
			throw new ForbiddenException('You are banned from this server');
		}
		if (!(await this.access.isMember(userId, serverId))) {
			throw new ForbiddenException('You are not a member of this server');
		}
		return true;
	}
}
