/**
 * Local identity-provider (IdP) schemas — syren acting as a syr instance.
 *
 * Hand-written Zod ported from syr's wire contracts rather than generated
 * from Rust: these shapes must stay byte-compatible with syr's own
 * (`syr/packages/ts/types/src/user.ts`, `identity.ts`), so the syr source
 * is the canonical reference, not a syren Rust struct.
 */
import { z } from 'zod';
import { RecordId } from 'surrealdb';

// ── Registration modes (syr: user.ts RegistrationModeSchema) ─────────

export const RegistrationModeSchema = z.enum(['open', 'invite_only', 'closed']);
export type RegistrationMode = z.infer<typeof RegistrationModeSchema>;

// ── Local account inputs (syr: user.ts UserRegistrationInputSchema) ──

export const LocalUsernameSchema = z
	.string()
	.min(3, 'Username must be at least 3 characters')
	.max(30, 'Username must be at most 30 characters')
	.regex(
		/^[a-zA-Z0-9_-]+$/,
		'Username can only contain letters, numbers, underscores, and hyphens'
	);

export const LocalPasswordSchema = z
	.string()
	.min(8, 'Password must be at least 8 characters')
	.regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
	.regex(/[a-z]/, 'Password must contain at least one lowercase letter')
	.regex(/[0-9]/, 'Password must contain at least one number');

export const LocalRegisterRequestSchema = z.object({
	username: LocalUsernameSchema,
	password: LocalPasswordSchema,
	display_name: z.string().min(1).max(100),
	invite_code: z
		.string()
		.min(1)
		.max(32)
		.regex(/^[a-zA-Z0-9]+$/, 'Invite code must be alphanumeric')
		.optional()
});
export type LocalRegisterRequest = z.infer<typeof LocalRegisterRequestSchema>;

export const LocalLoginRequestSchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1)
});
export type LocalLoginRequest = z.infer<typeof LocalLoginRequestSchema>;

/** Response for both local register and local login. The one-shot bridge
 * token is exchanged via POST /auth/exchange — same handoff the OAuth
 * callback uses — so the WASM client stores the session identically for
 * local and federated logins. */
export const LocalAuthResponseSchema = z.object({
	bridge: z.string(),
	did: z.string()
});
export type LocalAuthResponse = z.infer<typeof LocalAuthResponseSchema>;

export const RegistrationInfoSchema = z.object({
	mode: RegistrationModeSchema,
	/** Whether this instance supports local accounts at all (constant true, reserved). */
	local_accounts: z.boolean()
});
export type RegistrationInfo = z.infer<typeof RegistrationInfoSchema>;

// ── Invite codes (syr: user.ts InviteCodeValueSchema) ────────────────

export const InviteCodeValueSchema = z.object({
	created_by: z.string(),
	max_uses: z.number().int().min(1).nullable(),
	uses: z.number().int().min(0),
	created_at: z.string(),
	reserved_username: z
		.string()
		.min(1)
		.max(30)
		.regex(/^[a-zA-Z0-9_]+$/)
		.optional()
});
export type InviteCodeValue = z.infer<typeof InviteCodeValueSchema>;

// ── Aegis (CIGP) bundle (syr: @syr-is/crypto types.ts) ───────────────

export const AegisKdfParamsSchema = z.object({
	mem: z.number().int(),
	it: z.number().int(),
	par: z.number().int()
});
export type AegisKdfParams = z.infer<typeof AegisKdfParamsSchema>;

export const AegisBundleSchema = z.object({
	pub: z.string(),
	salt: z.string(),
	nonce: z.string(),
	ct: z.string(),
	tag: z.string(),
	kdf: AegisKdfParamsSchema
});
export type AegisBundle = z.infer<typeof AegisBundleSchema>;

// ── KV record ids (syr: kv.ts) ───────────────────────────────────────

const KV_SEGMENT_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * RecordId for a kv entry: `kv:<type>:<index>` (the id part is the
 * composite `type:index` string). Ported from syr's createKvRecordId.
 */
export function createKvRecordId(type: string, index: string): RecordId {
	if (!KV_SEGMENT_REGEX.test(type)) {
		throw new Error(`Invalid kv type segment: "${type}"`);
	}
	if (!index || index.length > 256) {
		throw new Error('Invalid kv index segment');
	}
	return new RecordId('kv', `${type}:${index}`);
}

// ── Manifests (syr: identity-manifest.ts, ported verbatim) ───────────

/**
 * Per-identity manifest served at `/.well-known/syr/{did}`.
 * Content negotiation: Accept json → manifest; else 302 → web_profile.
 */
export const SyrIdentityManifestSchema = z.object({
	version: z.literal(1),
	did: z.string(),
	provider: z.string().url(),
	endpoints: z.object({
		profile: z.string().url(),
		posts: z.string().url(),
		stories: z.string().url(),
		uploads: z.string().url(),
		did_document: z.string().url(),
		public_following: z.string().url().optional(),
		public_emojis: z.string().url().optional(),
		public_gifs: z.string().url().optional(),
		public_comments: z.string().url().optional(),
		public_reactions: z.string().url().optional(),
		public_hash: z.string().url().optional()
	}),
	web_profile: z.string().url()
});
export type SyrIdentityManifest = z.infer<typeof SyrIdentityManifestSchema>;

const httpUrlTemplate = z
	.string()
	.refine((s) => s.startsWith('http://') || s.startsWith('https://'), {
		message: 'Must be an absolute HTTP(S) URL or URL template'
	});

/**
 * Instance-level manifest served at `/.well-known/syr`. `name` is the
 * literal 'syr' — it identifies the protocol, not the product; consumer
 * schemas (including syren's own login flow) require it.
 */
export const SyrInstanceManifestSchema = z.object({
	name: z.literal('syr'),
	public_url: z.string().url(),
	api: z.object({
		public_profile: z.string().url(),
		public_posts: z.string().url(),
		public_stories: z.string().url(),
		public_uploads: z.string().url(),
		public_following: z.string().url().optional(),
		public_emojis: z.string().url().optional(),
		public_gifs: z.string().url().optional()
	}),
	identity_manifest_template: httpUrlTemplate,
	platform: z
		.object({
			consent: httpUrlTemplate,
			token: httpUrlTemplate,
			sign: httpUrlTemplate,
			challenge: httpUrlTemplate,
			delegations: httpUrlTemplate,
			revoke: httpUrlTemplate
		})
		.optional(),
	syner: z
		.object({
			// Device flows syren implements (root key on the device):
			independent_login_challenge: httpUrlTemplate,
			independent_login_verify: httpUrlTemplate,
			delegation_challenge_payload: httpUrlTemplate,
			delegation_verify: httpUrlTemplate,
			// syr's device content-signing surface. syren signs content
			// server-side (server-held delegate key), so these are optional —
			// present on a full syr host, absent here. Kept in the schema so a
			// syr-hosted manifest still validates against syren's copy.
			profile_sync: httpUrlTemplate.optional(),
			export_challenge: httpUrlTemplate.optional(),
			export_verify: httpUrlTemplate.optional(),
			export_signatures: httpUrlTemplate.optional(),
			sigil_handoff_payload: httpUrlTemplate.optional(),
			post_sign_payload: httpUrlTemplate.optional(),
			post_sign_signature: httpUrlTemplate.optional(),
			registry_sign_payload: httpUrlTemplate.optional(),
			registry_sign_signature: httpUrlTemplate.optional()
		})
		.optional()
});
export type SyrInstanceManifest = z.infer<typeof SyrInstanceManifestSchema>;

// ── Public profile payload (syr: /api/public/profile/[param]) ────────

export const PublicProfileDataSchema = z.object({
	did: z.string().nullable(),
	username: z.string(),
	display_name: z.string().nullish(),
	bio: z.string().nullish(),
	avatar_url: z.string().nullish(),
	banner_url: z.string().nullish(),
	identity_host_url: z.string().nullable(),
	content_signature: z.string().nullish(),
	signed_payload_json: z.string().nullish(),
	signing_device_public_key: z.string().nullish()
});
export type PublicProfileData = z.infer<typeof PublicProfileDataSchema>;

// ── Local profile edits ───────────────────────────────────────────────

export const LocalProfilePatchSchema = z.object({
	display_name: z.string().min(1).max(100).optional(),
	bio: z.string().max(500).optional()
});
export type LocalProfilePatch = z.infer<typeof LocalProfilePatchSchema>;

// ── Platform delegation (syr: platform-delegation.ts, ported) ────────

export const DidSyrSchema = z
	.string()
	.startsWith('did:syr:', 'Must be a did:syr identifier');

export const IdentityAuthScopeSchema = z.enum([
	'identity:read',
	'identity:verify',
	'profile:read',
	'posts:read',
	'posts:write'
]);
export type IdentityAuthScope = z.infer<typeof IdentityAuthScopeSchema>;

export const PlatformRegistrationRequestSchema = z.object({
	did: DidSyrSchema,
	platform_origin: z.string().url(),
	platform_name: z.string().min(1).max(100),
	callback_url: z.string().url(),
	scopes: z.array(IdentityAuthScopeSchema).min(1),
	state: z.string().optional()
});
export type PlatformRegistrationRequest = z.infer<typeof PlatformRegistrationRequestSchema>;

/** Token exchange body. syr's route reads delegation_id alongside the
 * schema'd fields, so it's part of the effective wire contract. */
export const PlatformTokenRequestSchema = z.object({
	code: z.string(),
	delegation_id: z.string(),
	callback_url: z.string().url(),
	platform_origin: z.string().url()
});
export type PlatformTokenRequest = z.infer<typeof PlatformTokenRequestSchema>;

export const PlatformSignRequestSchema = z.object({
	payload: z.record(z.string(), z.unknown()),
	payload_type: z.string().optional()
});
export type PlatformSignRequest = z.infer<typeof PlatformSignRequestSchema>;

export const PlatformChallengeRequestSchema = z.object({
	did: DidSyrSchema,
	platform_origin: z.string().url(),
	challenge: z.string().min(1)
});
export type PlatformChallengeRequest = z.infer<typeof PlatformChallengeRequestSchema>;

export const PlatformRevokeRequestSchema = z.object({
	platform_origin: z.string().url()
});
export type PlatformRevokeRequest = z.infer<typeof PlatformRevokeRequestSchema>;

/** Direct-entry consent registration (query-param variant of register,
 * used when a platform links straight to the consent page). */
export const PlatformConsentDirectSchema = z.object({
	platform_origin: z.string().url(),
	platform_name: z.string().min(1).max(100).optional(),
	callback_url: z.string().url(),
	scopes: z.string().optional(),
	state: z.string().optional()
});
export type PlatformConsentDirect = z.infer<typeof PlatformConsentDirectSchema>;

export const PlatformConsentApproveSchema = z.object({
	password: z.string().min(1)
});
export type PlatformConsentApprove = z.infer<typeof PlatformConsentApproveSchema>;

export const PlatformDelegationInfoSchema = z.object({
	delegate_public_key: z.string(),
	platform_origin: z.string(),
	platform_name: z.string(),
	scope: z.string(),
	created_at: z.string(),
	revoked_at: z.string().optional(),
	expires_at: z.string().optional()
});
export type PlatformDelegationInfo = z.infer<typeof PlatformDelegationInfoSchema>;

// ── Uploads / stories (syr: uploads.ts, stories.ts, ported) ──────────

/** Optional media dimensions carried alongside an upload. */
export const UploadMetadataSchema = z
	.object({
		width: z.number().int().positive().optional(),
		height: z.number().int().positive().optional(),
		duration_seconds: z.number().int().nonnegative().optional()
	})
	.passthrough();
export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;

/** Request body for a presigned PUT (story or library upload). */
export const UploadCreateSchema = z.object({
	filename: z.string().min(1),
	mime_type: z.string().min(1),
	size: z.number().int().nonnegative(),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	metadata: UploadMetadataSchema.optional(),
	folder_id: z.string().nullable().optional()
});
export type UploadCreate = z.infer<typeof UploadCreateSchema>;

/**
 * Result of a story/library presign — the client PUTs to `signed_url`.
 * Distinct from the chat `UploadPresignResponse` (generated): owned content
 * carries `did`/`local_id` from its composite key.
 */
export const OwnedUploadPresignResponseSchema = z.object({
	signed_url: z.string(),
	final_url: z.string(),
	upload_id: z.string(),
	did: z.string(),
	local_id: z.string(),
	max_bytes: z.number()
});
export type OwnedUploadPresignResponse = z.infer<typeof OwnedUploadPresignResponseSchema>;

/** Client-supplied metadata sent at complete-time. */
export const UploadCompleteSchema = z.object({
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional(),
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	duration_seconds: z.number().int().nonnegative().optional()
});
export type UploadComplete = z.infer<typeof UploadCompleteSchema>;

/**
 * One slide in a public story reel (last 24h). Ported verbatim from syr's
 * PublicStorySlideSchema (stories.ts) — federated consumers parse exactly this.
 */
export const PublicStorySlideSchema = z.object({
	id: z.string().min(1),
	mime_type: z.string().min(1),
	url: z.url(),
	published_at: z.string(),
	width: z.number().int().positive().optional().nullable(),
	height: z.number().int().positive().optional().nullable(),
	duration_seconds: z.number().nonnegative().optional().nullable()
});
export type PublicStorySlide = z.infer<typeof PublicStorySlideSchema>;

export const PublicStoriesResponseSchema = z.object({
	did: DidSyrSchema,
	slides: z.array(PublicStorySlideSchema)
});
export type PublicStoriesResponse = z.infer<typeof PublicStoriesResponseSchema>;

/** Owner-facing story row (GET /api/stories). Superset of a slide. */
export const OwnedStorySchema = z.object({
	did: z.string(),
	local_id: z.string(),
	filename: z.string(),
	mime_type: z.string(),
	size: z.number(),
	url: z.string().nullable().optional(),
	status: z.enum(['pending', 'finalizing', 'completed', 'failed']),
	is_public: z.boolean(),
	is_story: z.boolean(),
	published_at: z.string().nullable().optional(),
	created_at: z.string(),
	updated_at: z.string(),
	width: z.number().int().positive().optional().nullable(),
	height: z.number().int().positive().optional().nullable(),
	duration_seconds: z.number().nonnegative().optional().nullable()
});
export type OwnedStory = z.infer<typeof OwnedStorySchema>;

// ── Full profile edit (avatar/banner + signed content) ───────────────

export const ProfileAssetKindSchema = z.enum(['avatar', 'banner']);
export type ProfileAssetKind = z.infer<typeof ProfileAssetKindSchema>;

/** Presign request for a profile avatar/banner image. */
export const ProfileAssetPresignSchema = z.object({
	kind: ProfileAssetKindSchema,
	filename: z.string().min(1),
	mime_type: z.string().min(1),
	size: z.number().int().positive(),
	sha256: z
		.string()
		.regex(/^[a-f0-9]{64}$/i)
		.optional()
});
export type ProfileAssetPresign = z.infer<typeof ProfileAssetPresignSchema>;

/** Full profile patch (P4) — adds avatar/banner URL fields over the P2 minimal patch. */
export const FullProfilePatchSchema = z.object({
	display_name: z.string().min(1).max(100).optional(),
	bio: z.string().max(500).optional(),
	avatar_url: z.string().url().nullable().optional(),
	banner_url: z.string().url().nullable().optional()
});
export type FullProfilePatch = z.infer<typeof FullProfilePatchSchema>;

// ── Library uploads + folders (P7) ───────────────────────────────────
// Owner-facing file library on the same composite-id `library_upload` table
// that backs stories (library files are `is_story=false`). The federation
// surface is GET /api/public/uploads/:did, whose wire shape is ported verbatim
// from syr's routes/api/public/uploads/[did]. Unlike syr (which encodes
// public/private into the S3 key + relies on anonymous bucket reads), syren
// proxies every remote asset through its auth-gated media proxy, so `is_public`
// is a pure DB flag: it gates federation listing + share-link behaviour, not
// object reachability. Keys are therefore stable across a visibility toggle.

/** Folder name — syr's charset (no path separators / shell-glob chars). */
export const FolderNameSchema = z
	.string()
	.min(1)
	.max(255)
	.regex(/^[^/\\*?"<>|]+$/, 'Name cannot contain / \\ * ? " < > |');

export const FolderCreateSchema = z.object({
	name: FolderNameSchema,
	parent_id: z.string().nullable().optional(),
	is_public: z.boolean().optional()
});
export type FolderCreate = z.infer<typeof FolderCreateSchema>;

export const FolderUpdateSchema = z
	.object({
		name: FolderNameSchema.optional(),
		parent_id: z.string().nullable().optional(),
		is_public: z.boolean().optional()
	})
	.refine((v) => v.name !== undefined || v.parent_id !== undefined || v.is_public !== undefined, {
		message: 'Provide at least one field to update'
	});
export type FolderUpdate = z.infer<typeof FolderUpdateSchema>;

/** Owner-facing folder row. `path` is the folder-name chain, root → leaf. */
export const OwnedFolderSchema = z.object({
	id: z.string(),
	name: z.string(),
	parent_id: z.string().nullable(),
	is_public: z.boolean(),
	path: z.array(z.string()),
	created_at: z.string(),
	updated_at: z.string()
});
export type OwnedFolder = z.infer<typeof OwnedFolderSchema>;

export const FolderBreadcrumbSchema = z.object({ id: z.string(), name: z.string() });
export type FolderBreadcrumb = z.infer<typeof FolderBreadcrumbSchema>;

export const FoldersListResponseSchema = z.object({
	folders: z.array(OwnedFolderSchema),
	breadcrumbs: z.array(FolderBreadcrumbSchema)
});
export type FoldersListResponse = z.infer<typeof FoldersListResponseSchema>;

/** Presign a library file — the upload create shape plus an optional public flag. */
export const LibraryPresignSchema = UploadCreateSchema.extend({
	is_public: z.boolean().optional()
});
export type LibraryPresign = z.infer<typeof LibraryPresignSchema>;

/** Rename / move / re-scope a library file (at least one field required). */
export const UploadPatchSchema = z
	.object({
		filename: z.string().min(1).max(255).optional(),
		folder_id: z.string().nullable().optional(),
		is_public: z.boolean().optional()
	})
	.refine(
		(v) => v.filename !== undefined || v.folder_id !== undefined || v.is_public !== undefined,
		{ message: 'Provide at least one field to update' }
	);
export type UploadPatch = z.infer<typeof UploadPatchSchema>;

/** Owner-facing library file (superset of a story row, minus the story-only bits). */
export const OwnedUploadSchema = z.object({
	did: z.string(),
	local_id: z.string(),
	folder_id: z.string().nullable(),
	filename: z.string(),
	mime_type: z.string(),
	size: z.number(),
	url: z.string().nullable(),
	status: z.enum(['pending', 'finalizing', 'completed', 'failed']),
	is_public: z.boolean(),
	created_at: z.string(),
	updated_at: z.string(),
	width: z.number().int().positive().nullable().optional(),
	height: z.number().int().positive().nullable().optional(),
	duration_seconds: z.number().nonnegative().nullable().optional()
});
export type OwnedUpload = z.infer<typeof OwnedUploadSchema>;

export const OwnedUploadsPageSchema = z.object({
	data: z.array(OwnedUploadSchema),
	breadcrumbs: z.array(FolderBreadcrumbSchema),
	pagination: z.object({
		limit: z.number(),
		offset: z.number(),
		total: z.number(),
		has_more: z.boolean()
	})
});
export type OwnedUploadsPage = z.infer<typeof OwnedUploadsPageSchema>;

/** Share-link request/response — ported from syr's ShareUrlSchema + route. */
export const ShareLinkRequestSchema = z.object({
	expiresIn: z.number().int().min(60).max(604800).default(3600)
});
export type ShareLinkRequest = z.infer<typeof ShareLinkRequestSchema>;

export const ShareLinkResponseSchema = z.object({
	url: z.string(),
	expiresAt: z.string(),
	isPublic: z.boolean()
});
export type ShareLinkResponse = z.infer<typeof ShareLinkResponseSchema>;

/** Storage-usage — shape ported verbatim from syr's getUsageDetails. */
export const StorageUsageSchema = z.object({
	bytes_used: z.number(),
	bytes_limit: z.number(),
	percentage_used: z.number(),
	bytes_remaining: z.number()
});
export type StorageUsage = z.infer<typeof StorageUsageSchema>;

/** One public library file — ported verbatim from syr's public uploads route. */
export const PublicUploadSchema = z.object({
	id: z.string(),
	did: z.string(),
	local_id: z.string(),
	owner_id: z.string(),
	folder_id: z.string().nullable(),
	filename: z.string(),
	mime_type: z.string(),
	size: z.number(),
	url: z.string(),
	status: z.string(),
	is_public: z.boolean(),
	created_at: z.string(),
	updated_at: z.string()
});
export type PublicUpload = z.infer<typeof PublicUploadSchema>;

export const PublicUploadsResponseSchema = z.object({
	data: z.array(PublicUploadSchema),
	pagination: z.object({
		limit: z.number(),
		offset: z.number(),
		total: z.number(),
		has_more: z.boolean()
	})
});
export type PublicUploadsResponse = z.infer<typeof PublicUploadsResponseSchema>;

// ── Instance limits (admin-configurable) ─────────────────────────────
// Two instance-level upload limits, both admin-settable and stored in the kv
// `instance_config` table (env `SYREN_MAX_FILE_SIZE_MB` / `SYREN_STORAGE_LIMIT_GB`
// seed the defaults). The per-file cap is enforced on every upload path across
// the platform (chat attachments, library, stories, post assets, profile);
// the per-account storage quota is enforced on the file library.

/** Current instance limits — GET /api/instance/limits (public). */
export const InstanceLimitsSchema = z.object({
	max_file_size_mb: z.number(),
	max_file_size_bytes: z.number(),
	storage_limit_gb: z.number(),
	storage_limit_bytes: z.number()
});
export type InstanceLimits = z.infer<typeof InstanceLimitsSchema>;

/** PATCH /api/instance/limits (admin) — at least one field. */
export const InstanceLimitsPatchSchema = z
	.object({
		max_file_size_mb: z.number().int().min(1).max(4096).optional(),
		storage_limit_gb: z.number().min(0.1).max(10000).optional()
	})
	.refine((v) => v.max_file_size_mb !== undefined || v.storage_limit_gb !== undefined, {
		message: 'Provide at least one limit to update'
	});
export type InstanceLimitsPatch = z.infer<typeof InstanceLimitsPatchSchema>;

/** GET /api/instance/admin — whether the caller is an instance admin. */
export const InstanceAdminStatusSchema = z.object({ is_admin: z.boolean() });
export type InstanceAdminStatus = z.infer<typeof InstanceAdminStatusSchema>;

/** One row of the admin user table (GET /api/instance/users). */
export const InstanceUserSchema = z.object({
	did: z.string(),
	username: z.string(),
	role: z.enum(['USER', 'ADMIN']),
	created_at: z.string(),
	storage_bytes: z.number(),
	file_count: z.number()
});
export type InstanceUser = z.infer<typeof InstanceUserSchema>;

export const InstanceUsersPageSchema = z.object({
	items: z.array(InstanceUserSchema),
	total: z.number()
});
export type InstanceUsersPage = z.infer<typeof InstanceUsersPageSchema>;

// ── Comments / reactions / follows (P8) ──────────────────────────────
// Ported from syr's comment/reaction/follow wire contracts
// (syr/apps/syr/app/src/lib/{controllers,repositories}/{comment,reaction,follow}.*
// + routes/api/public/{comments,reactions,following}/[did]). Two syren
// divergences, both deliberate:
//   1. Ownership lives in the composite key (`table:{ created_by:<did>, id }`),
//      so there is no `author_id` column — every query filters `id.created_by`,
//      exactly as syren's posts/emojis/gifs already do. Follows use a composite
//      key too (syr uses a plain auto id), which keeps the whole interaction set
//      portable for import/export (P11).
//   2. syr's public reads are per-author (`/public/comments/:did` = comments
//      *authored by* :did). That's kept verbatim for federation + export, but
//      to actually render a post's full thread we add by-target aggregation
//      reads (`…/threads/*`) that return every interaction hosted on this
//      instance for a given target — the same-instance display path. Fanning
//      those in across instances is the registry's job (P9).

export const CommentVisibilitySchema = z.enum(['public', 'unlisted', 'private']);
export type CommentVisibility = z.infer<typeof CommentVisibilitySchema>;

export const CommentStatusSchema = z.enum(['draft', 'completed']);
export type CommentStatus = z.infer<typeof CommentStatusSchema>;

/** Create a comment on a post. `ancestor_chain` is the ordered root→parent path
 * of `"did:local_id"` refs ([] for a root comment) — syr's threading model. */
export const CommentCreateSchema = z.object({
	post_did: DidSyrSchema,
	post_id: z.string().min(1),
	ancestor_chain: z.array(z.string().min(1)).max(32).default([]),
	content: z.string().min(1).max(4000),
	visibility: CommentVisibilitySchema.default('public'),
	status: CommentStatusSchema.default('completed'),
	/** Preserve an explicit ULID on import (keeps cross-instance reply links). */
	comment_local_id: z.string().min(1).max(64).optional()
});
export type CommentCreate = z.infer<typeof CommentCreateSchema>;

export const CommentUpdateSchema = z
	.object({
		content: z.string().min(1).max(4000).optional(),
		visibility: CommentVisibilitySchema.optional(),
		status: CommentStatusSchema.optional()
	})
	.refine(
		(v) => v.content !== undefined || v.visibility !== undefined || v.status !== undefined,
		{ message: 'Provide at least one field to update' }
	);
export type CommentUpdate = z.infer<typeof CommentUpdateSchema>;

/** A comment on the wire — owner-facing and public reads share this shape
 * (the public read simply never exposes drafts / non-public). Signature fields
 * are attached server-side at create via the account's self-delegation. */
export const OwnedCommentSchema = z.object({
	did: z.string(),
	local_id: z.string(),
	post_did: z.string(),
	post_id: z.string(),
	ancestor_chain: z.array(z.string()),
	content: z.string(),
	visibility: CommentVisibilitySchema,
	status: CommentStatusSchema,
	created_at: z.string(),
	updated_at: z.string(),
	content_signature: z.string().optional(),
	signed_payload_json: z.string().optional(),
	signing_device_public_key: z.string().optional()
});
export type OwnedComment = z.infer<typeof OwnedCommentSchema>;

export const PublicCommentSchema = OwnedCommentSchema;
export type PublicComment = z.infer<typeof PublicCommentSchema>;

export const CommentsPageSchema = z.object({
	data: z.array(PublicCommentSchema),
	pagination: z.object({
		limit: z.number(),
		offset: z.number(),
		total: z.number(),
		has_more: z.boolean()
	})
});
export type CommentsPage = z.infer<typeof CommentsPageSchema>;

// Reactions ───────────────────────────────────────────────────────────
// (`ReactionKindSchema` is already taken by chat-message reactions in
// generated.ts — this content-reaction kind is a superset, hence the prefix.)

export const ReactionParentTypeSchema = z.enum(['post', 'comment']);
export type ReactionParentType = z.infer<typeof ReactionParentTypeSchema>;

export const IdpReactionKindSchema = z.enum(['unicode', 'custom_emoji', 'sticker', 'gif']);
export type IdpReactionKind = z.infer<typeof IdpReactionKindSchema>;

/** Toggle a reaction on a post or comment (re-POSTing the same one removes it). */
export const ReactionCreateSchema = z.object({
	parent_type: ReactionParentTypeSchema,
	parent_did: DidSyrSchema,
	parent_id: z.string().min(1),
	kind: IdpReactionKindSchema,
	value: z.string().min(1).max(64),
	image_url: z.string().url().optional()
});
export type ReactionCreate = z.infer<typeof ReactionCreateSchema>;

export const PublicReactionSchema = z.object({
	did: z.string(),
	local_id: z.string(),
	parent_type: ReactionParentTypeSchema,
	parent_did: z.string(),
	parent_id: z.string(),
	kind: IdpReactionKindSchema,
	value: z.string(),
	image_url: z.string().nullable(),
	created_at: z.string()
});
export type PublicReaction = z.infer<typeof PublicReactionSchema>;

export const ReactionsPageSchema = z.object({
	data: z.array(PublicReactionSchema),
	pagination: z.object({
		limit: z.number(),
		offset: z.number(),
		total: z.number(),
		has_more: z.boolean()
	})
});
export type ReactionsPage = z.infer<typeof ReactionsPageSchema>;

/** POST /api/reactions result — a toggle: either created (with the row) or removed. */
export const ReactionToggleResponseSchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('created'), data: PublicReactionSchema }),
	z.object({ action: z.literal('removed') })
]);
export type ReactionToggleResponse = z.infer<typeof ReactionToggleResponseSchema>;

// Follows ─────────────────────────────────────────────────────────────

/** Follow a DID. `provider_url` is the followed identity's home instance base
 * URL — the client already resolved it to render the profile, so it supplies
 * it (registry-based auto-resolution is P9). */
export const FollowCreateSchema = z.object({
	followed_did: DidSyrSchema,
	provider_url: z.string().url().optional()
});
export type FollowCreate = z.infer<typeof FollowCreateSchema>;

/** Toggle a follow's public visibility (whether it shows on the public list). */
export const FollowVisibilitySchema = z.object({
	followed_did: DidSyrSchema,
	followed_provider_url: z.string().url().nullable().optional(),
	is_public: z.boolean()
});
export type FollowVisibility = z.infer<typeof FollowVisibilitySchema>;

/** Owner-facing follow row (GET /api/follows). syr also carries `source_registry`;
 * omitted here until registry integration (P9). */
export const OwnedFollowSchema = z.object({
	followed_did: z.string(),
	followed_provider_url: z.string().nullable(),
	is_public: z.boolean(),
	created_at: z.string()
});
export type OwnedFollow = z.infer<typeof OwnedFollowSchema>;

/** Public following row — port of syr's publicFollowRowToJson (no registry). */
export const PublicFollowSchema = z.object({
	followed_did: z.string(),
	followed_provider_url: z.string().nullable(),
	created_at: z.string()
});
export type PublicFollow = z.infer<typeof PublicFollowSchema>;

/** GET /api/public/following/:did — syr's shape: only a `total`, no limit/offset. */
export const PublicFollowingResponseSchema = z.object({
	data: z.array(PublicFollowSchema),
	pagination: z.object({ total: z.number() })
});
export type PublicFollowingResponse = z.infer<typeof PublicFollowingResponseSchema>;

export const FollowCheckResponseSchema = z.object({ following: z.boolean() });
export type FollowCheckResponse = z.infer<typeof FollowCheckResponseSchema>;

// ── Registry / discovery outbox (P9) ─────────────────────────────────
// Announce "this DID is hosted at <provider>" to external discovery registries
// via a root-signed hosting record pushed through an outbox job queue. Ported
// from syr's identity_registry + outbox (syr/apps/syr/.../services/db.ts,
// registry-job-crypto.ts, registry-job-runner.ts, registry.ts wire schemas).
//
// syren divergence: syr signs client-side (its server never holds the root
// key); syren stores the Aegis-encrypted root seed, so the SYNC endpoint takes
// the password and signs server-side. Because a signed record carries a fixed
// `updatedAt`, an @Interval poller can autonomously RE-DELIVER a signed job
// whose push failed — signing needs the password, redelivery does not.
//
// The registry contract is byte-identical to syr's: JCS(RFC 8785) over
// `{did, provider, updatedAt}` (update) / `{did, deletedAt}` (delete) /
// `{did, provider, username, displayName, listed, updatedAt}` (directory),
// root-signed (the key is the one embedded in the did:syr), POSTed to
// `{registry}/api/v1/{update,delete,directory/upsert}`.

export const RegistryStatusSchema = z.enum(['pending', 'synced', 'error']);
export type RegistryStatus = z.infer<typeof RegistryStatusSchema>;

/** A publication registry the user announces to (owner-facing row). */
export const OwnedRegistrySchema = z.object({
	id: z.string(),
	registry_url: z.string(),
	status: RegistryStatusSchema,
	last_synced_at: z.string().nullable(),
	created_at: z.string()
});
export type OwnedRegistry = z.infer<typeof OwnedRegistrySchema>;

/** Add a registry — base URL (no `/api/v1`, appended at push time). */
export const RegistryAddSchema = z.object({
	registry_url: z.string().url()
});
export type RegistryAdd = z.infer<typeof RegistryAddSchema>;

/** Sync now — password unlocks the root seed to sign pending hosting records. */
export const RegistrySyncSchema = z.object({
	password: z.string().min(1)
});
export type RegistrySync = z.infer<typeof RegistrySyncSchema>;

export const OutboxJobStatusSchema = z.enum([
	'pending',
	'processing',
	'completed',
	'failed',
	'cancelled'
]);
export type OutboxJobStatus = z.infer<typeof OutboxJobStatusSchema>;

export const OutboxJobActionSchema = z.enum(['update', 'delete']);
export type OutboxJobAction = z.infer<typeof OutboxJobActionSchema>;

/** An outbox job (owner-facing). `signed` = a valid signature is stored, so the
 * background poller can redeliver it without the password. */
export const OwnedOutboxJobSchema = z.object({
	id: z.string(),
	action: OutboxJobActionSchema,
	registry_url: z.string(),
	status: OutboxJobStatusSchema,
	attempts: z.number(),
	max_attempts: z.number(),
	signed: z.boolean(),
	last_error: z.string().nullable(),
	next_retry_at: z.string().nullable(),
	created_at: z.string(),
	updated_at: z.string()
});
export type OwnedOutboxJob = z.infer<typeof OwnedOutboxJobSchema>;

/** Result of a sync run. */
export const RegistrySyncResultSchema = z.object({
	signed: z.number(),
	delivered: z.number(),
	failed: z.number(),
	jobs: z.array(OwnedOutboxJobSchema)
});
export type RegistrySyncResult = z.infer<typeof RegistrySyncResultSchema>;

// ── Registry HTTP wire contract (ported verbatim from syr's registry.ts) ──
// The exact bodies syren POSTs to a registry server — a real syr registry
// validates against these, so they must stay byte-compatible.

export const RegistryUpdateRecordSchema = z.object({
	did: z.string(),
	provider: z.string().url(),
	updatedAt: z.string(),
	signature: z.string()
});
export type RegistryUpdateRecord = z.infer<typeof RegistryUpdateRecordSchema>;

export const RegistryDeleteRecordSchema = z.object({
	did: z.string(),
	deletedAt: z.string(),
	signature: z.string()
});
export type RegistryDeleteRecord = z.infer<typeof RegistryDeleteRecordSchema>;

export const RegistryDirectoryUpsertSchema = z.object({
	did: z.string(),
	provider: z.string().url(),
	username: z.string().min(1).max(64),
	displayName: z.string().min(1).max(100),
	listed: z.boolean(),
	updatedAt: z.string(),
	signature: z.string()
});
export type RegistryDirectoryUpsert = z.infer<typeof RegistryDirectoryUpsertSchema>;

// ════════════════════════════════════════════════════════════════════════
// P10 — Syner self-custody (two-round delegation + independent login)
// ════════════════════════════════════════════════════════════════════════
//
// syren does server-side content signing via a server-held delegate key
// (encrypted under PLATFORM_DELEGATE_SECRET), while the *root* key is either
// Aegis-encrypted (password accounts) or held on the user's device
// (self-custody). The two-round flow: the server generates the delegate
// keypair + a canonical delegation statement in round 1; the device signs
// that statement with the root key in round 2; the server persists the
// delegate + the device's root signature. What gets signed is always the
// JCS-canonical statement STRING, verified verbatim (never re-canonicalized).

/** Round-1 response for a device-signed delegation (consent-page QR). */
export const SynerChallengeResponseSchema = z.object({
	challenge_id: z.string(),
	message: z.string(),
	deeplink_url: z.string(),
	delegate_public_key: z.string(),
	expires_in: z.number()
});
export type SynerChallengeResponse = z.infer<typeof SynerChallengeResponseSchema>;

/** Payload the signing device reads (does not consume the challenge). */
export const DelegationPayloadResponseSchema = z.object({
	message: z.string(),
	platform_name: z.string(),
	platform_origin: z.string(),
	delegate_public_key: z.string(),
	did: z.string()
});
export type DelegationPayloadResponse = z.infer<typeof DelegationPayloadResponseSchema>;

/** Round-2 request: the device's root signature over the statement. */
export const DelegationVerifyRequestSchema = z.object({
	challenge_id: z.string(),
	did: DidSyrSchema,
	signature: z.string().min(1)
});
export type DelegationVerifyRequest = z.infer<typeof DelegationVerifyRequestSchema>;

/** Consent-page poll: has the device signed yet? */
export const ConsentStatusResponseSchema = z.object({
	signed: z.boolean(),
	redirect_url: z.string().nullable()
});
export type ConsentStatusResponse = z.infer<typeof ConsentStatusResponseSchema>;

// ── Independent login (self-custody sign-in to this instance) ──────────────
// The same device-signed delegation, but the delegation authorizes THIS
// instance (platform_origin = our PUBLIC_URL). On verify the server creates
// the self-custody identity (no Aegis columns) + a server delegate + a
// session — so a self-custody user is functionally equivalent to an Aegis
// user for server-side operations, with the root key never leaving the device.

export const IndependentLoginChallengeRequestSchema = z.object({
	did: DidSyrSchema,
	invite_code: z.string().optional(),
	display_name: z.string().min(1).max(100).optional()
});
export type IndependentLoginChallengeRequest = z.infer<
	typeof IndependentLoginChallengeRequestSchema
>;

export const IndependentLoginChallengeResponseSchema = z.object({
	challenge_id: z.string(),
	message: z.string(),
	deeplink_url: z.string(),
	delegate_public_key: z.string(),
	expires_in: z.number()
});
export type IndependentLoginChallengeResponse = z.infer<
	typeof IndependentLoginChallengeResponseSchema
>;

export const IndependentLoginVerifyRequestSchema = z.object({
	challenge_id: z.string(),
	did: DidSyrSchema,
	signature: z.string().min(1)
});
export type IndependentLoginVerifyRequest = z.infer<typeof IndependentLoginVerifyRequestSchema>;

export const IndependentLoginVerifyResponseSchema = z.object({
	success: z.literal(true)
});
export type IndependentLoginVerifyResponse = z.infer<typeof IndependentLoginVerifyResponseSchema>;

/** Web-page poll: once the device signs, the browser receives a one-shot
 * bridge token and exchanges it for a session exactly like local login. */
export const IndependentLoginStatusResponseSchema = z.object({
	verified: z.boolean(),
	bridge: z.string().nullable()
});
export type IndependentLoginStatusResponse = z.infer<
	typeof IndependentLoginStatusResponseSchema
>;

// ════════════════════════════════════════════════════════════════════════
// P11 — Identity import / export
// ════════════════════════════════════════════════════════════════════════
//
// A portable, signed .zip of an identity's owned content. Because every owned
// record uses a composite id `table:{created_by: <did>, id: <ulid>}`, the DID
// is baked into every key — re-importing the same DID is conflict-free
// (idempotent upsert by composite key). Aegis (password) accounts export the
// encrypted seed bundle so re-import restores login with the same password;
// self-custody accounts omit it (the seed lives on the device).

export const IdentityExportCountsSchema = z.object({
	posts: z.number(),
	stories: z.number(),
	emojis: z.number(),
	gifs: z.number(),
	uploads: z.number(),
	comments: z.number(),
	reactions: z.number(),
	follows: z.number(),
	registries: z.number(),
	assets: z.number()
});
export type IdentityExportCounts = z.infer<typeof IdentityExportCountsSchema>;

/** `manifest.json` at the root of an export bundle. */
export const IdentityExportManifestSchema = z.object({
	version: z.literal(1),
	did: z.string(),
	public_key: z.string(),
	username: z.string(),
	host: z.string().url(),
	exported_at: z.string(),
	includes_seed: z.boolean(),
	counts: IdentityExportCountsSchema,
	/** SHA-256 (hex) over the sorted record+asset digest — what the signature
	 * covers. Recomputed on import and checked byte-for-byte. */
	content_digest: z.string()
});
export type IdentityExportManifest = z.infer<typeof IdentityExportManifestSchema>;

/** Export request — password root-signs the bundle digest (Aegis accounts). */
export const IdentityExportRequestSchema = z.object({
	password: z.string().min(1)
});
export type IdentityExportRequest = z.infer<typeof IdentityExportRequestSchema>;

/** Register-with-import form (multipart; the zip rides alongside as a file). */
export const RegisterWithImportSchema = z.object({
	username: z
		.string()
		.min(3)
		.max(32)
		.regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscores only'),
	password: z.string().min(8).max(200),
	invite_code: z.string().optional()
});
export type RegisterWithImport = z.infer<typeof RegisterWithImportSchema>;

/** Result of an import run. */
export const IdentityImportResultSchema = z.object({
	did: z.string(),
	imported: IdentityExportCountsSchema
});
export type IdentityImportResult = z.infer<typeof IdentityImportResultSchema>;
