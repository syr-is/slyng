import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import {
	ServerRepository,
	ServerMemberRepository,
	ServerRoleRepository,
	ServerInviteRepository
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

const repositories = [
	ServerRepository,
	ServerMemberRepository,
	ServerRoleRepository,
	ServerInviteRepository,
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
	UploadRepository
];

@Global()
@Module({
	providers: [DbService, ...repositories],
	exports: [DbService, ...repositories]
})
export class DbModule {}
