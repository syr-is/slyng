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
import {
	FriendshipRepository,
	UserBlockRepository,
	UserIgnoreRepository
} from '../relation/relation.repository';
import { PermissionOverrideRepository } from '../permission-override/override.repository';
import {
	LocalAccountRepository,
	IdentityRepository,
	DelegatedKeyRepository,
	IdpProfileRepository
} from '../idp/idp.repository';
import {
	LibraryUploadRepository,
	FolderRepository
} from '../idp/idp-content.repository';
import { PostRepository } from '../idp/idp-post.repository';
import { EmojiRepository, GifRepository } from '../idp/idp-media.repository';
import {
	ServerEmojiRepository,
	ServerGifRepository
} from '../server-media/server-media.repository';
import {
	CommentRepository,
	ReactionRepository,
	FollowRepository
} from '../idp/idp-interaction.repository';
import {
	IdentityRegistryRepository,
	OutboxRepository
} from '../idp/idp-registry.repository';
import { IdpAuditRepository } from '../idp/idp-audit.repository';

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
	AuditLogRepository,
	FriendshipRepository,
	UserBlockRepository,
	UserIgnoreRepository,
	PermissionOverrideRepository,
	LocalAccountRepository,
	IdentityRepository,
	DelegatedKeyRepository,
	IdpProfileRepository,
	LibraryUploadRepository,
	FolderRepository,
	PostRepository,
	EmojiRepository,
	GifRepository,
	ServerEmojiRepository,
	ServerGifRepository,
	CommentRepository,
	ReactionRepository,
	FollowRepository,
	IdentityRegistryRepository,
	OutboxRepository,
	IdpAuditRepository
];

@Global()
@Module({
	providers: [DbService, ...repositories],
	exports: [DbService, ...repositories]
})
export class DbModule {}
