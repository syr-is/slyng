import { Module, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE, APP_INTERCEPTOR } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { RecordIdInterceptor } from './common/record-id.interceptor';
import { DbModule } from './db/db.module';
import { DbService } from './db/db.service';
import { ServerModule } from './server/server.module';
import { ChannelModule } from './channel/channel.module';
import { MessageModule } from './message/message.module';
import { GatewayModule } from './gateway/gateway.module';
import { EmbedModule } from './embed/embed.module';
import { MemberModule } from './member/member.module';
import { AuthModule } from './auth/auth.module';
import { RoleModule } from './role/role.module';
import { ProfileWatcherModule } from './profile-watcher/profile-watcher.module';
import { UploadModule } from './upload/upload.module';
import { ProxyModule } from './proxy/proxy.module';
import { UserModule } from './user/user.module';
import { VoiceModule } from './voice/voice.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { RelationModule } from './relation/relation.module';
import { OverrideModule } from './permission-override/override.module';
import { CategoryModule } from './category/category.module';
import { join } from 'node:path';

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			envFilePath: [
				join(process.cwd(), '../../../.env.local'),
				join(process.cwd(), '../../../.env')
			]
		}),
		DbModule,
		ServerModule,
		ChannelModule,
		MessageModule,
		GatewayModule,
		EmbedModule,
		MemberModule,
		AuthModule,
		RoleModule,
		ProfileWatcherModule,
		UploadModule,
		ProxyModule,
		UserModule,
		VoiceModule,
		AuditLogModule,
		RelationModule,
		OverrideModule,
		CategoryModule
	],
	providers: [
		{ provide: APP_PIPE, useClass: ZodValidationPipe },
		{ provide: APP_INTERCEPTOR, useClass: RecordIdInterceptor }
	]
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(AppModule.name);

	constructor(private readonly db: DbService) {}

	async onModuleInit() {
		await this.db.connect();
		await this.db.initializeSchema();
		this.logger.log('Application initialized');
	}

	async onModuleDestroy() {
		await this.db.disconnect();
		this.logger.log('Application destroyed');
	}
}
