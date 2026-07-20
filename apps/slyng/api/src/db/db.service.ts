import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Surreal } from 'surrealdb';

@Injectable()
export class DbService implements OnModuleDestroy {
	private readonly logger = new Logger(DbService.name);
	private db: Surreal;
	private connected = false;

	constructor(private readonly config: ConfigService) {
		this.db = new Surreal();
	}

	async connect(): Promise<void> {
		if (this.connected) return;

		const url = this.config.get('SURREALDB_URL', 'ws://localhost:8100/rpc');
		const user = this.config.get('SURREALDB_USER', 'root');
		const pass = this.config.get('SURREALDB_PASS', 'slyng-dev-password');
		const namespace = this.config.get('SURREALDB_NAMESPACE', 'slyng');
		const database = this.config.get('SURREALDB_DATABASE', 'slyng');

		await this.db.connect(url);
		await this.db.signin({ username: user, password: pass });
		await this.db.use({ namespace, database });

		this.connected = true;
		this.logger.log(`Connected to SurrealDB at ${url}`);
	}

	async initializeSchema(): Promise<void> {
		await this.db.query(`
			DEFINE TABLE IF NOT EXISTS server SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_server_owner ON TABLE server COLUMNS owner_id;

			DEFINE TABLE IF NOT EXISTS server_member SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_member_server ON TABLE server_member COLUMNS server_id;
			DEFINE INDEX IF NOT EXISTS idx_member_user ON TABLE server_member COLUMNS user_id;
			DEFINE INDEX IF NOT EXISTS idx_member_unique ON TABLE server_member COLUMNS server_id, user_id UNIQUE;

			DEFINE TABLE IF NOT EXISTS server_role SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_role_server ON TABLE server_role COLUMNS server_id;

			DEFINE TABLE IF NOT EXISTS server_invite SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_invite_code ON TABLE server_invite COLUMNS code UNIQUE;
			DEFINE INDEX IF NOT EXISTS idx_invite_server ON TABLE server_invite COLUMNS server_id;

			DEFINE TABLE IF NOT EXISTS channel_category SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_category_server ON TABLE channel_category COLUMNS server_id;

			DEFINE TABLE IF NOT EXISTS channel SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_channel_server ON TABLE channel COLUMNS server_id;

			DEFINE TABLE IF NOT EXISTS channel_participant SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_participant_channel ON TABLE channel_participant COLUMNS channel_id;
			DEFINE INDEX IF NOT EXISTS idx_participant_user ON TABLE channel_participant COLUMNS user_id;

			DEFINE TABLE IF NOT EXISTS message SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_message_channel ON TABLE message COLUMNS channel_id;
			DEFINE INDEX IF NOT EXISTS idx_message_sender ON TABLE message COLUMNS sender_id;

			DEFINE TABLE IF NOT EXISTS message_reaction SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_reaction_message ON TABLE message_reaction COLUMNS message_id;

			DEFINE TABLE IF NOT EXISTS pinned_message SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_pinned_channel ON TABLE pinned_message COLUMNS channel_id;

			DEFINE TABLE IF NOT EXISTS channel_read_state SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_read_user ON TABLE channel_read_state COLUMNS user_id;
			DEFINE INDEX IF NOT EXISTS idx_read_channel ON TABLE channel_read_state COLUMNS channel_id;

			DEFINE TABLE IF NOT EXISTS voice_state SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_voice_channel ON TABLE voice_state COLUMNS channel_id;
			DEFINE INDEX IF NOT EXISTS idx_voice_user ON TABLE voice_state COLUMNS user_id;

			DEFINE TABLE IF NOT EXISTS user SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_user_did ON TABLE user COLUMNS did UNIQUE;

			DEFINE TABLE IF NOT EXISTS platform_session SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_session_user ON TABLE platform_session COLUMNS user_id;
			DEFINE INDEX IF NOT EXISTS idx_session_did ON TABLE platform_session COLUMNS did;

			DEFINE TABLE IF NOT EXISTS upload SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_upload_uploader ON TABLE upload COLUMNS uploader_id;
			DEFINE INDEX IF NOT EXISTS idx_upload_channel ON TABLE upload COLUMNS channel_id;

			DEFINE TABLE IF NOT EXISTS server_ban SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_ban_server_user ON TABLE server_ban COLUMNS server_id, user_id;
			DEFINE INDEX IF NOT EXISTS idx_ban_active ON TABLE server_ban COLUMNS active;

			DEFINE TABLE IF NOT EXISTS audit_log SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_audit_server_created ON TABLE audit_log COLUMNS server_id, created_at;
			DEFINE INDEX IF NOT EXISTS idx_audit_target_user ON TABLE audit_log COLUMNS server_id, target_user_id;
			DEFINE INDEX IF NOT EXISTS idx_audit_action ON TABLE audit_log COLUMNS server_id, action;
			DEFINE INDEX IF NOT EXISTS idx_audit_channel ON TABLE audit_log COLUMNS server_id, channel_id;

			DEFINE TABLE IF NOT EXISTS friendship SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_friendship_pair ON TABLE friendship COLUMNS user_a_id, user_b_id UNIQUE;
			DEFINE INDEX IF NOT EXISTS idx_friendship_user_a ON TABLE friendship COLUMNS user_a_id;
			DEFINE INDEX IF NOT EXISTS idx_friendship_user_b ON TABLE friendship COLUMNS user_b_id;
			DEFINE INDEX IF NOT EXISTS idx_friendship_status ON TABLE friendship COLUMNS status;

			DEFINE TABLE IF NOT EXISTS user_block SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_block_pair ON TABLE user_block COLUMNS blocker_id, blocked_id UNIQUE;
			DEFINE INDEX IF NOT EXISTS idx_block_blocker ON TABLE user_block COLUMNS blocker_id;

			DEFINE TABLE IF NOT EXISTS user_ignore SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_ignore_pair ON TABLE user_ignore COLUMNS user_id, ignored_id UNIQUE;
			DEFINE INDEX IF NOT EXISTS idx_ignore_user ON TABLE user_ignore COLUMNS user_id;

			DEFINE TABLE IF NOT EXISTS permission_override SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_perm_override_server ON TABLE permission_override COLUMNS server_id;
			DEFINE INDEX IF NOT EXISTS idx_perm_override_scope ON TABLE permission_override COLUMNS scope_type, scope_id;
			DEFINE INDEX IF NOT EXISTS idx_perm_override_target ON TABLE permission_override COLUMNS target_type, target_id;
			DEFINE INDEX IF NOT EXISTS idx_perm_override_unique ON TABLE permission_override COLUMNS server_id, scope_type, scope_id, target_type, target_id UNIQUE;

			-- Local identity provider (slyng-as-syr-instance). Table shapes
			-- mirror syr's (apps/syr/app/src/lib/services/db.ts) so content
			-- stays portable between slyng and dedicated syr instances.
			DEFINE TABLE IF NOT EXISTS local_account SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_local_account_username ON TABLE local_account COLUMNS username UNIQUE;
			DEFINE INDEX IF NOT EXISTS idx_local_account_did ON TABLE local_account COLUMNS did UNIQUE;

			DEFINE TABLE IF NOT EXISTS identity SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_identity_did ON TABLE identity COLUMNS did UNIQUE;
			DEFINE INDEX IF NOT EXISTS idx_identity_account ON TABLE identity COLUMNS account_id UNIQUE;

			DEFINE TABLE IF NOT EXISTS delegated_key SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_delegated_key_public ON TABLE delegated_key COLUMNS public_key UNIQUE;
			DEFINE INDEX IF NOT EXISTS idx_delegated_key_did ON TABLE delegated_key COLUMNS did;
			DEFINE INDEX IF NOT EXISTS idx_delegated_key_origin ON TABLE delegated_key COLUMNS did, scope, platform_origin;

			DEFINE TABLE IF NOT EXISTS profile SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_profile_account ON TABLE profile COLUMNS account_id UNIQUE;

				-- Root-key rotation chain (P12). One row per rotation statement.
				-- The (did, seq) UNIQUE index is the atomicity/rollback backstop:
				-- a divergent or replayed same-seq append fails at the DB tier,
				-- rolling back the enclosing transaction. The current root is
				-- always derived from the verified chain, never a stored column.
				DEFINE TABLE IF NOT EXISTS identity_rotation SCHEMALESS;
				DEFINE INDEX IF NOT EXISTS idx_identity_rotation_did ON TABLE identity_rotation COLUMNS did;
				DEFINE INDEX IF NOT EXISTS idx_identity_rotation_seq ON TABLE identity_rotation COLUMNS did, seq UNIQUE;

			DEFINE TABLE IF NOT EXISTS kv SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_kv_type ON TABLE kv COLUMNS kv_type;
			DEFINE INDEX IF NOT EXISTS idx_kv_expires ON TABLE kv COLUMNS expires_at;

			-- Owned/portable content (composite ids: table:{created_by, id}).
			-- Named library_upload to avoid colliding with the chat upload
			-- table. The id.created_by subfield indexes are defined separately
			-- below (best-effort — some SurrealDB builds reject them).
			DEFINE TABLE IF NOT EXISTS library_upload SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_library_upload_folder ON TABLE library_upload COLUMNS folder_id;
			DEFINE INDEX IF NOT EXISTS idx_library_upload_status ON TABLE library_upload COLUMNS status;
			DEFINE INDEX IF NOT EXISTS idx_library_upload_public ON TABLE library_upload COLUMNS is_public;

			DEFINE TABLE IF NOT EXISTS folder SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_folder_owner ON TABLE folder COLUMNS owner_id;
			DEFINE INDEX IF NOT EXISTS idx_folder_owner_name ON TABLE folder COLUMNS owner_id, name, parent_id;

			-- Owned blog/media posts (composite ids: post:{created_by, id}).
			-- The id.created_by subfield index is defined separately below.
			DEFINE TABLE IF NOT EXISTS post SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_post_visibility ON TABLE post COLUMNS visibility;
			DEFINE INDEX IF NOT EXISTS idx_post_status ON TABLE post COLUMNS status;

			-- Custom emoji + personal GIFs (composite ids: {emoji,gif}:{created_by, id}).
			DEFINE TABLE IF NOT EXISTS emoji SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_emoji_status ON TABLE emoji COLUMNS status;
			DEFINE TABLE IF NOT EXISTS gif SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_gif_status ON TABLE gif COLUMNS status;

			-- Interactions (P8): comments + reactions (composite ids), follows
			-- (composite id keyed by follower did). Post/target lookups index
			-- the flat columns; per-author + by-follower listings ride the
			-- id.created_by subfield index defined separately below.
			DEFINE TABLE IF NOT EXISTS comment SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_comment_post ON TABLE comment COLUMNS post_did, post_id;
			DEFINE TABLE IF NOT EXISTS reaction SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_reaction_target ON TABLE reaction COLUMNS parent_type, parent_did, parent_id;
			DEFINE TABLE IF NOT EXISTS user_follow SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_user_follow_followed ON TABLE user_follow COLUMNS followed_did;

			-- Registry / discovery outbox (P9). identity_registry: publication
			-- registries the user announces to. outbox: root-signed hosting-record
			-- push jobs (durable, retryable). Both are instance-local job/config
			-- state (hard-deleted), not composite-id owned content.
			DEFINE TABLE IF NOT EXISTS identity_registry SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_identity_registry_did ON TABLE identity_registry COLUMNS identity_did;
			DEFINE INDEX IF NOT EXISTS idx_identity_registry_unique ON TABLE identity_registry COLUMNS identity_did, registry_url UNIQUE;
			DEFINE TABLE IF NOT EXISTS outbox SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_outbox_actor ON TABLE outbox COLUMNS actor_did;
			DEFINE INDEX IF NOT EXISTS idx_outbox_status_retry ON TABLE outbox COLUMNS status, next_retry_at;

			-- Instance-level identity audit (distinct from server-scoped audit_log).
			DEFINE TABLE IF NOT EXISTS idp_audit_log SCHEMALESS;
			DEFINE INDEX IF NOT EXISTS idx_idp_audit_actor ON TABLE idp_audit_log COLUMNS actor_did, created_at;
			DEFINE INDEX IF NOT EXISTS idx_idp_audit_action ON TABLE idp_audit_log COLUMNS action;
		`);

		// Composite-id (id.created_by) indexes speed the DID-scoped story /
		// profile listings. Indexing a record-id subfield isn't supported on
		// every SurrealDB build, so isolate it: an unsupported syntax logs a
		// warning instead of aborting schema init (the queries still work via
		// a scan until the index lands). Mirrors syr's db.ts.
		try {
			await this.db.query(`
				DEFINE INDEX IF NOT EXISTS idx_library_upload_created_by ON TABLE library_upload COLUMNS id.created_by;
					DEFINE INDEX IF NOT EXISTS idx_emoji_created_by ON TABLE emoji COLUMNS id.created_by;
					DEFINE INDEX IF NOT EXISTS idx_gif_created_by ON TABLE gif COLUMNS id.created_by;
					DEFINE INDEX IF NOT EXISTS idx_comment_created_by ON TABLE comment COLUMNS id.created_by;
					DEFINE INDEX IF NOT EXISTS idx_reaction_created_by ON TABLE reaction COLUMNS id.created_by;
					DEFINE INDEX IF NOT EXISTS idx_user_follow_created_by ON TABLE user_follow COLUMNS id.created_by;
			`);
		} catch (err) {
			this.logger.warn(
				`Could not define id.created_by indexes on composite-id tables (record-id subfield). ` +
					`DID-scoped listings stay scan-based until added: ${(err as Error).message}`
			);
		}

		// Backfill pre-existing rows that were created before new fields were added.
		await this.db.query(`UPDATE server_ban SET active = true WHERE active = NONE;`);
		await this.db.query(`UPDATE message SET deleted = false WHERE deleted = NONE;`);
		await this.db.query(`UPDATE channel SET deleted = false WHERE deleted = NONE;`);
		await this.db.query(`UPDATE server_role SET deleted = false WHERE deleted = NONE;`);
		// Block 11: tristate role permissions. Copy legacy `permissions` bitmask
		// into `permissions_allow`; default `permissions_deny` to '0'. Idempotent
		// because the WHERE clauses only match rows missing the new fields.
		await this.db.query(
			`UPDATE server_role SET permissions_allow = permissions WHERE permissions_allow = NONE;`
		);
		await this.db.query(
			`UPDATE server_role SET permissions_deny = '0' WHERE permissions_deny = NONE;`
		);
		// Relations: default DM + friend-request policies to 'open' for existing users.
		await this.db.query(`UPDATE user SET allow_dms = 'open' WHERE allow_dms = NONE;`);
		await this.db.query(
			`UPDATE user SET allow_friend_requests = 'open' WHERE allow_friend_requests = NONE;`
		);

		this.logger.log('Schema initialized');
	}

	getDb(): Surreal {
		if (!this.connected) {
			throw new Error('Slyng DB not connected');
		}
		return this.db;
	}

	async disconnect(): Promise<void> {
		if (this.connected) {
			await this.db.close();
			this.connected = false;
			this.logger.log('Disconnected from SurrealDB');
		}
	}

	async onModuleDestroy() {
		await this.disconnect();
	}
}
