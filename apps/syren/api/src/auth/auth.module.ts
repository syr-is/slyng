import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { MemberAccessService } from './member-access.service';
import { ServerAccessGuard } from './server-access.guard';
import { PermissionGuard } from './permission.guard';

@Module({
	controllers: [AuthController],
	providers: [
		AuthService,
		AuthGuard,
		MemberAccessService,
		ServerAccessGuard,
		PermissionGuard,
		{ provide: APP_GUARD, useClass: AuthGuard },
		{ provide: APP_GUARD, useClass: ServerAccessGuard },
		{ provide: APP_GUARD, useClass: PermissionGuard }
	],
	exports: [AuthService, AuthGuard, MemberAccessService, ServerAccessGuard, PermissionGuard]
})
export class AuthModule {}
