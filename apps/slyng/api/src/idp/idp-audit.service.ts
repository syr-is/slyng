import { Injectable, Logger } from '@nestjs/common';
import { IdpAuditRepository } from './idp-audit.repository';

/**
 * Identity-scoped audit log — the IdP counterpart to the server-scoped
 * `AuditLogService`. Every local-DID content mutation (profile edit, asset
 * upload, story publish/delete, and — in later phases — posts/emojis/gifs)
 * records here. Fire-and-forget like the chat audit log: a failed write logs
 * a warning and never takes down the originating mutation.
 */
export type IdpAuditAction =
	| 'profile_update'
	| 'profile_asset_update'
	| 'story_publish'
	| 'story_delete'
	| 'post_create'
	| 'post_update'
	| 'post_delete'
	| 'emoji_create'
	| 'emoji_delete'
	| 'gif_create'
	| 'gif_delete'
	| 'upload_create'
	| 'upload_update'
	| 'upload_delete'
	| 'upload_share'
	| 'folder_create'
	| 'folder_update'
	| 'folder_delete'
	| 'comment_create'
	| 'comment_update'
	| 'comment_delete'
	| 'reaction_add'
	| 'reaction_remove'
	| 'follow_create'
	| 'follow_update'
	| 'follow_delete'
	| 'registry_add'
	| 'registry_remove'
	| 'registry_sync'
	| 'identity_rotate';

export type IdpAuditTargetKind =
	| 'profile'
	| 'story'
	| 'post'
	| 'emoji'
	| 'gif'
	| 'upload'
	| 'folder'
	| 'comment'
	| 'reaction'
	| 'follow'
	| 'registry'
	| 'identity';

@Injectable()
export class IdpAuditService {
	private readonly logger = new Logger(IdpAuditService.name);

	constructor(private readonly repo: IdpAuditRepository) {}

	async record(params: {
		actorDid: string;
		action: IdpAuditAction;
		targetKind: IdpAuditTargetKind;
		targetId?: string | null;
		metadata?: Record<string, unknown>;
	}): Promise<void> {
		try {
			await this.repo.create({
				actor_did: params.actorDid,
				action: params.action,
				target_kind: params.targetKind,
				target_id: params.targetId ?? null,
				metadata: params.metadata ?? {},
				created_at: new Date()
			});
		} catch (err) {
			this.logger.warn(
				`idp audit write failed action=${params.action} actor=${params.actorDid}: ${(err as Error).message}`
			);
		}
	}
}
