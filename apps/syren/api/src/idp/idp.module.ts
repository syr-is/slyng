import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { AccountService } from './account.service';
import { DelegationStoreService } from './delegation-store.service';
import { IdpAuditService } from './idp-audit.service';
import { IdpCryptoService } from './idp-crypto.service';
import { IdpJwtService } from './idp-jwt.service';
import { IdpPublicController } from './idp-public.controller';
import { IdpPublicService } from './idp-public.service';
import { IdpStorageService } from './idp-storage.service';
import { KvService } from './kv.service';
import { LocalAuthController } from './local-auth.controller';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformTokenGuard } from './platform-token.guard';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { EmojiController } from './emoji.controller';
import { EmojiService } from './emoji.service';
import { GifController } from './gif.controller';
import { GifService } from './gif.service';
import { InstanceController } from './instance.controller';
import { InstanceConfigService } from './instance-config.service';
import { InstanceAdminService } from './instance-admin.service';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { ProfileService } from './profile.service';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import {
	CommentController,
	ReactionController,
	FollowController
} from './interaction.controller';
import { CommentService } from './comment.service';
import { ReactionService } from './reaction.service';
import { FollowService } from './follow.service';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';
import { IndependentLoginController } from './independent-login.controller';
import { IdentityMigrationController } from './identity-migration.controller';
import { IdentityExportService } from './identity-export.service';
import { IdentityImportService } from './identity-import.service';
import { WellKnownController } from './well-known.controller';

/**
 * Local identity provider — syren acting as a full syr instance.
 * Repositories for the IdP tables live in DbModule (global) like every
 * other repository; this module owns the services + endpoints.
 */
@Module({
	imports: [
		AuthModule,
		// Scoped rate limits for the local-auth endpoints (per-route
		// @Throttle overrides); not registered as a global guard.
		ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 30 }])
	],
	controllers: [
		LocalAuthController,
		WellKnownController,
		IdpPublicController,
		PlatformController,
		StoryController,
		PostController,
		EmojiController,
		GifController,
		LibraryController,
		InstanceController,
		CommentController,
		ReactionController,
		FollowController,
		RegistryController,
		IndependentLoginController,
		IdentityMigrationController
	],
	providers: [
		IdpCryptoService,
		IdpJwtService,
		KvService,
		PlatformService,
		AccountService,
		IdpPublicService,
		IdpStorageService,
		IdpAuditService,
		ProfileService,
		StoryService,
		PostService,
		EmojiService,
		GifService,
		LibraryService,
		InstanceConfigService,
		InstanceAdminService,
		CommentService,
		ReactionService,
		FollowService,
		RegistryService,
		IdentityExportService,
		IdentityImportService,
		DelegationStoreService,
		PlatformTokenGuard
	],
	exports: [
		IdpCryptoService,
		IdpJwtService,
		KvService,
		PlatformService,
		AccountService,
		IdpPublicService,
		IdpStorageService,
		IdpAuditService,
		ProfileService,
		StoryService,
		PostService,
		InstanceConfigService,
		DelegationStoreService
	]
})
export class IdpModule {}
