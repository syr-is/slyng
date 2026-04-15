import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import {
	ServerRepository,
	ServerMemberRepository,
	ServerRoleRepository,
	ServerInviteRepository,
	ServerBanRepository
} from '../server/server.repository';
import {
	ChannelRepository,
	ChannelParticipantRepository,
	ChannelCategoryRepository,
	ChannelReadStateRepository
} from '../channel/channel.repository';
import {
	MessageRepository,
	MessageReactionRepository,
	PinnedMessageRepository
} from '../message/message.repository';
import { VoiceStateRepository } from '../voice/voice.repository';
import { UserRepository, PlatformSessionRepository } from '../auth/user.repository';
import { UploadRepository } from '../upload/upload.repository';
import { AuditLogRepository } from '../audit-log/audit-log.repository';

const repositories = [
	ServerRepository,
	ServerMemberRepository,
	ServerRoleRepository,
	ServerInviteRepository,
	ServerBanRepository,
	ChannelRepository,
	ChannelParticipantRepository,
	ChannelCategoryRepository,
	ChannelReadStateRepository,
	MessageRepository,
	MessageReactionRepository,
	PinnedMessageRepository,
	VoiceStateRepository,
	UserRepository,
	PlatformSessionRepository,
	UploadRepository,
	AuditLogRepository
];

@Global()
@Module({
	providers: [DbService, ...repositories],
	exports: [DbService, ...repositories]
})
export class DbModule {}
