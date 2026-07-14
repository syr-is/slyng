import { Controller, Get, Header, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { IdpPublicService } from './idp-public.service';

/**
 * syr discovery endpoints at the site root — excluded from the global
 * `/api` prefix in main.ts. These are what make slyng discoverable as a
 * syr instance: federated consumers (including slyng's own frontend
 * stores) resolve identities through them.
 */
@ApiTags('well-known')
@Controller('.well-known')
export class WellKnownController {
	constructor(private readonly publicService: IdpPublicService) {}

	@Public()
	@Get('syr')
	@Header('Cache-Control', 'public, max-age=300')
	@ApiOperation({ summary: 'syr instance manifest' })
	instanceManifest() {
		return this.publicService.buildInstanceManifest();
	}

	@Public()
	@Get('syr/:did')
	@ApiOperation({ summary: 'Per-identity syr manifest (content-negotiated)' })
	async identityManifest(
		@Param('did') did: string,
		@Req() req: Request,
		@Res() res: Response
	) {
		const manifest = await this.publicService.buildIdentityManifest(decodeURIComponent(did));
		// Content negotiation, as syr does it: API clients send
		// Accept: application/json and get the manifest; browsers get a
		// redirect to the human-facing profile page.
		const accept = req.headers.accept ?? '';
		if (accept.includes('application/json')) {
			res
				.status(200)
				.setHeader('Cache-Control', 'public, max-age=300')
				.setHeader('Vary', 'Accept')
				.json(manifest);
			return;
		}
		res.redirect(302, manifest.web_profile);
	}

	@Public()
	@Get('did/:did')
	@Header('Content-Type', 'application/did+ld+json')
	@Header('Cache-Control', 'public, max-age=300')
	@ApiOperation({ summary: 'DID document (well-known alias)' })
	async didDocument(@Param('did') did: string) {
		return this.publicService.getDidDocument(decodeURIComponent(did));
	}
}
