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
		const pass = this.config.get('SURREALDB_PASS', 'syren-dev-password');
		const namespace = this.config.get('SURREALDB_NAMESPACE', 'syren');
		const database = this.config.get('SURREALDB_DATABASE', 'syren');

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
		`);

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
			throw new Error('Syren DB not connected');
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
