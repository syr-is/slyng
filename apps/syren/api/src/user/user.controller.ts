import { Controller, Get, Patch, Body, Req, UseGuards, HttpException } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { UserRepository } from '../auth/user.repository';

@Controller('users')
@UseGuards(AuthGuard)
export class UserController {
	constructor(private readonly users: UserRepository) {}

	@Get('@me')
	async me(@Req() req: any) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Unauthorized', 401);

		const user = await this.users.findOne({ did });
		if (!user) throw new HttpException('User not found', 404);

		return {
			did: (user as any).did,
			syr_instance_url: (user as any).syr_instance_url,
			trusted_domains: (user as any).trusted_domains ?? []
		};
	}

	@Patch('@me')
	async updateMe(@Req() req: any, @Body() body: { trusted_domains?: string[] }) {
		const did = req.user?.did;
		if (!did) throw new HttpException('Unauthorized', 401);

		const merge: Record<string, unknown> = { updated_at: new Date() };

		if (body.trusted_domains !== undefined) {
			if (!Array.isArray(body.trusted_domains)) {
				throw new HttpException('trusted_domains must be an array', 400);
			}
			// Validate: only valid hostnames, max 200 entries
			const cleaned = [...new Set(body.trusted_domains.filter((d) => typeof d === 'string' && d.length > 0))];
			if (cleaned.length > 200) {
				throw new HttpException('Too many trusted domains (max 200)', 400);
			}
			merge.trusted_domains = cleaned;
		}

		await this.users.mergeWhere({ did }, merge as any);
		const updated = await this.users.findOne({ did });

		return {
			did: (updated as any).did,
			syr_instance_url: (updated as any).syr_instance_url,
			trusted_domains: (updated as any).trusted_domains ?? []
		};
	}
}
