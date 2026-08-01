import { Controller, Get, Patch, Query, Body, Req, UseGuards, HttpException, Inject, Optional, Logger } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SkipServerAccess } from '../auth/server-access.decorator';
import { UserRepository } from '../auth/user.repository';
import { WsOp, type AllowDms, type AllowFriendRequests } from '@slyng/types';
import { ChatGateway } from '../gateway/chat.gateway';
import { UpdateMyselfDto } from '../dto';
import type { AuthedRequest } from '../auth/authed-request';

@Controller('users')
@UseGuards(AuthGuard)
export class UserController {
	private readonly logger = new Logger(UserController.name);

	constructor(
		private readonly users: UserRepository,
		@Optional() @Inject(ChatGateway) private readonly gateway?: ChatGateway
	) {}

	@Get('@me')
	async me(@Req() req: AuthedRequest) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Unauthorized', 401);

		const user = await this.users.findOne({ did });
		if (!user) throw new HttpException('User not found', 404);

		return {
			did: user.did,
			syr_instance_url: user.syr_instance_url,
			trusted_domains: user.trusted_domains ?? [],
			allow_dms: (user.allow_dms as AllowDms | undefined) ?? 'open',
			allow_friend_requests:
				(user.allow_friend_requests as AllowFriendRequests | undefined) ?? 'open'
		};
	}

	@Get('resolve')
	@SkipServerAccess()
	async resolve(@Query('q') q: string, @Req() req: AuthedRequest) {
		if (!req.user?.id) throw new HttpException('Unauthorized', 401);
		if (!q?.trim()) throw new HttpException('q parameter required', 400);
		const input = q.trim();

		let did: string;
		let instanceUrl: string;

		if (input.startsWith('did:syr:')) {
			did = input;
			const user = (await this.users.findOne({ did })) as any;
			return {
				did,
				syr_instance_url: (user?.syr_instance_url as string | undefined) ?? null,
				registered: !!user
			};
		}

		const atIdx = input.indexOf('@');
		if (atIdx <= 0 || atIdx === input.length - 1) {
			throw new HttpException('Input must be a DID (did:syr:...) or handle (user@instance.host)', 400);
		}

		const username = input.slice(0, atIdx);
		const host = input.slice(atIdx + 1).toLowerCase();
		instanceUrl = `https://${host}`;

		try {
			const manifestRes = await fetch(`${instanceUrl}/.well-known/syr`, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(5000)
			});
			if (!manifestRes.ok) throw new Error('Instance manifest unavailable');
			const manifest = (await manifestRes.json()) as {
				api?: { public_profile?: string };
			};
			const profileBase = manifest.api?.public_profile;
			if (!profileBase) throw new Error('Instance does not expose public profiles');

			const profileRes = await fetch(`${profileBase}/${encodeURIComponent(username)}`, {
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(5000)
			});
			if (!profileRes.ok) throw new Error('Profile not found');
			const body = (await profileRes.json()) as { data?: { did?: string } };
			const resolvedDid = body.data?.did;
			if (!resolvedDid) throw new Error('Profile has no DID');
			did = resolvedDid;
		} catch (err) {
			this.logger.debug(`resolve failed for ${input}: ${err instanceof Error ? err.message : err}`);
			throw new HttpException(
				err instanceof Error ? err.message : 'Failed to resolve user',
				404
			);
		}

		const user = (await this.users.findOne({ did })) as any;
		return {
			did,
			syr_instance_url: (user?.syr_instance_url as string | undefined) ?? instanceUrl,
			registered: !!user
		};
	}

	@Patch('@me')
	async updateMe(@Req() req: AuthedRequest, @Body() body: UpdateMyselfDto) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Unauthorized', 401);

		const merge: Record<string, unknown> = { updated_at: new Date() };
		let policyChanged = false;

		if (body.trusted_domains !== undefined) {
			merge.trusted_domains = [...new Set(body.trusted_domains.filter((d) => d.length > 0))];
		}

		if (body.allow_dms !== undefined) {
			merge.allow_dms = body.allow_dms;
			policyChanged = true;
		}

		if (body.allow_friend_requests !== undefined) {
			merge.allow_friend_requests = body.allow_friend_requests;
			policyChanged = true;
		}

		await this.users.mergeWhere({ did }, merge);
		const updated = await this.users.findOne({ did });
		// findOne is nullable; the previous cast let a missing row reach the
		// property reads below and throw a bare TypeError instead of a 404.
		if (!updated) throw new HttpException('User not found', 404);

		const result = {
			did: updated.did,
			syr_instance_url: updated.syr_instance_url,
			trusted_domains: updated.trusted_domains ?? [],
			allow_dms: (updated.allow_dms as AllowDms | undefined) ?? 'open',
			allow_friend_requests:
				(updated.allow_friend_requests as AllowFriendRequests | undefined) ?? 'open'
		};

		// Broadcast DM policy changes to all of the user's own sockets so other
		// tabs see the updated selector immediately. Harmless when policy
		// didn't change.
		if (policyChanged) {
			this.gateway?.emitToUser(did, {
				op: WsOp.DM_POLICY_UPDATE,
				d: {
					allow_dms: result.allow_dms,
					allow_friend_requests: result.allow_friend_requests
				}
			});
		}

		return result;
	}
}
