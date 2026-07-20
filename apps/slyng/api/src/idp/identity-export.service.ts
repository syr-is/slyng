import { HttpException, Injectable, Logger } from '@nestjs/common';
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { canonicalize, encodeMultibase, sign } from '@slyng/idp-crypto';
import { extractLocalId } from '@slyng/types';
import type { IdentityExportManifest, IdentityExportCounts } from '@slyng/types';
import type { RecordId } from 'surrealdb';
import { IdpCryptoService } from './idp-crypto.service';
import { IdpStorageService } from './idp-storage.service';
import {
	IdentityRepository,
	IdpProfileRepository,
	LocalAccountRepository,
	type IdentityRow
} from './idp.repository';
import { PostRepository } from './idp-post.repository';
import { EmojiRepository, GifRepository } from './idp-media.repository';
import { LibraryUploadRepository } from './idp-content.repository';
import { CommentRepository, ReactionRepository, FollowRepository } from './idp-interaction.repository';
import { RootKeyService } from './root-key.service';

interface ExportedRecord {
	local_id: string;
	record: Record<string, unknown>;
}

/**
 * Identity export (P11): a portable, root-signed `.zip` of an identity's
 * owned content. Every owned record is composite-keyed
 * (`table:{created_by: <did>, id}`), so the DID is baked into each key —
 * re-import is conflict-free. Local S3 assets are bundled by their key so a
 * new host can re-host them under the same path. Aegis (password) accounts
 * also export the encrypted seed bundle so re-import restores login with the
 * same password; the whole thing is signed by the root key.
 */
@Injectable()
export class IdentityExportService {
	private readonly logger = new Logger(IdentityExportService.name);

	constructor(
		private readonly crypto: IdpCryptoService,
		private readonly storage: IdpStorageService,
		private readonly accounts: LocalAccountRepository,
		private readonly identities: IdentityRepository,
		private readonly profiles: IdpProfileRepository,
		private readonly posts: PostRepository,
		private readonly emojis: EmojiRepository,
		private readonly gifs: GifRepository,
		private readonly uploads: LibraryUploadRepository,
		private readonly comments: CommentRepository,
		private readonly reactions: ReactionRepository,
		private readonly follows: FollowRepository,
		private readonly rootKey: RootKeyService
	) {}

	/**
	 * Build an export bundle for `did`. Custody decides the bundle kind:
	 * - **Custodial (Aegis)** — the root seed is held here (encrypted). The
	 *   password unlocks it to SIGN the v2 manifest (proving authenticity) and
	 *   the encrypted seed is embedded so re-import restores password login: a
	 *   FULL, signed bundle.
	 * - **Self-custody** — the seed lives on the device, so the server can't
	 *   sign. It emits an explicit `unsigned: true` DATA-ONLY bundle (no seed
	 *   embedded), never a silent downgrade. Restorable only into an existing
	 *   session for the same DID; its authenticity rests on the file-hash map +
	 *   the importer's own session.
	 */
	async exportIdentity(
		did: string,
		password?: string
	): Promise<{ zip: Uint8Array; filename: string }> {
		const account = await this.accounts.findByDid(did);
		if (!account) throw new HttpException('Account not found', 404);
		const identity = await this.identities.findByDid(did);
		if (!identity) throw new HttpException('Identity not found', 404);
		const profile = await this.profiles.findByAccountId(account.id);

		const hasAegis = this.identityHasAegis(identity);

		// Custodial exports sign; self-custody exports don't. `rootSign` is the
		// signer, or null for the unsigned data-only path.
		let rootSign: ((statement: string) => Promise<Uint8Array>) | null = null;
		if (hasAegis) {
			if (!password) {
				throw new HttpException('Password is required to sign a custodial export', 400);
			}
			const bundle = this.crypto.aegisBundleFromIdentity(identity);
			rootSign = (statement: string) =>
				this.crypto.withSeed({ bundle, password, action: (seed) => sign(statement, seed) });
			// Fail fast on a bad password before doing all the gathering work.
			try {
				await rootSign('export-probe');
			} catch {
				throw new HttpException('Incorrect password', 401);
			}
		}

		// Rotation chain (P12): every bundle carries the full chain so it
		// self-verifies offline. For a custodial export the Aegis seed IS the
		// CURRENT root (post-rotation), so `signing_key` is that key.
		const rotationChain = await this.rootKey.loadChain(did);

		// ── Gather owned content ──────────────────────────────────────────
		const [postRows, emojiRows, gifRows, uploadRows, commentRows, reactionRows, followRows] =
			await Promise.all([
				this.posts.findByOwnerDid(did),
				this.emojis.findByOwnerDid(did),
				this.gifs.findByOwnerDid(did),
				this.uploads.findByOwnerDid(did),
				this.comments.findByOwnerDid(did),
				this.reactions.findByOwnerDid(did),
				this.follows.findByOwnerDid(did)
			]);
		const storyRows = uploadRows.filter((u) => u.is_story === true);
		const libraryRows = uploadRows.filter((u) => u.is_story !== true);

		const files: Record<string, Uint8Array> = {};
		const addJson = (name: string, value: unknown) => {
			files[name] = strToU8(JSON.stringify(value, null, 0));
		};

		addJson('records/posts.json', postRows.map((r) => this.toExport(r.id, r)));
		addJson('records/emojis.json', emojiRows.map((r) => this.toExport(r.id, r)));
		addJson('records/gifs.json', gifRows.map((r) => this.toExport(r.id, r)));
		addJson('records/stories.json', storyRows.map((r) => this.toExport(r.id, r)));
		addJson('records/uploads.json', libraryRows.map((r) => this.toExport(r.id, r)));
		addJson('records/comments.json', commentRows.map((r) => this.toExport(r.id, r)));
		addJson('records/reactions.json', reactionRows.map((r) => this.toExport(r.id, r)));
		addJson('records/follows.json', followRows.map((r) => this.toExport(r.id, r)));

		if (profile) {
			addJson('profile.json', {
				display_name: profile.display_name ?? null,
				bio: profile.bio ?? null,
				avatar_url: profile.avatar_url ?? null,
				banner_url: profile.banner_url ?? null,
				content_signature: profile.content_signature ?? null,
				signed_payload_json: profile.signed_payload_json ?? null,
				signing_device_public_key: profile.signing_device_public_key ?? null
			});
		}

		// identity.json carries the immutable genesis public key + the full
		// rotation chain (P12) so the bundle self-verifies offline. A custodial
		// export also embeds the encrypted seed (Aegis) so re-import restores
		// password login; a self-custody export omits it (the seed is on the
		// device — that's what makes it a data-only bundle).
		const identityJson: Record<string, unknown> = {
			did,
			public_key: identity.public_key,
			rotation_chain: rotationChain
		};
		if (hasAegis) {
			identityJson.aegis = {
				salt: identity.aegis_salt,
				nonce: identity.aegis_nonce,
				ct: identity.aegis_ct,
				tag: identity.aegis_tag,
				kdf: {
					mem: identity.aegis_kdf_mem,
					it: identity.aegis_kdf_it,
					par: identity.aegis_kdf_par
				}
			};
		}
		addJson('identity.json', identityJson);

		// ── Bundle local S3 assets by key ─────────────────────────────────
		const assetKeys = new Set<string>();
		const collect = (rows: Array<Record<string, unknown>>) => {
			for (const row of rows) {
				for (const url of this.assetUrls(row)) {
					const key = this.urlToLocalKey(url);
					if (key) assetKeys.add(key);
				}
			}
		};
		collect(postRows);
		collect(emojiRows);
		collect(gifRows);
		collect(uploadRows);
		if (profile) collect([profile]);

		const assetIndex: Array<{ key: string; mime: string }> = [];
		for (const key of assetKeys) {
			const bytes = await this.storage.getObjectBuffer(key);
			if (!bytes) {
				this.logger.warn(`Export ${did.slice(0, 16)}…: asset missing, skipping ${key}`);
				continue;
			}
			files[`assets/${key}`] = new Uint8Array(bytes);
			assetIndex.push({ key, mime: this.mimeFromKey(key) });
		}
		addJson('assets.json', assetIndex);

		// ── Per-file digest map + v2 manifest + detached signature ────────
		const counts: IdentityExportCounts = {
			posts: postRows.length,
			stories: storyRows.length,
			emojis: emojiRows.length,
			gifs: gifRows.length,
			uploads: libraryRows.length,
			comments: commentRows.length,
			reactions: reactionRows.length,
			follows: followRows.length,
			registries: 0,
			assets: assetIndex.length
		};
		const createdAt = new Date().toISOString();
		// SHA-256 of every bundle file. `manifest.json` is added to the archive
		// AFTER this runs, so it's naturally excluded from its own integrity map.
		const fileHashes = this.hashFiles(files);
		const manifestSansSig = {
			format_version: 2 as const,
			did,
			created_at: createdAt,
			rotation_seq: rotationChain.length,
			counts,
			files: fileHashes
		};
		let manifest: IdentityExportManifest;
		if (rootSign) {
			// Custodial: sign the RFC 8785 (JCS) canonicalization of the manifest
			// (minus the signature block) with the CURRENT root — the Aegis seed IS
			// the current root after any rotation, so `signing_key` is that key.
			const signingKey = await this.rootKey.getCurrentRootMultibase(did);
			const signedPayloadJson = canonicalize(manifestSansSig);
			const signature = encodeMultibase(await rootSign(signedPayloadJson));
			manifest = {
				...manifestSansSig,
				signature: {
					signed_payload_json: signedPayloadJson,
					signature,
					signing_key: signingKey
				}
			};
		} else {
			// Self-custody: explicit unsigned data-only bundle — the manifest says
			// so, so import can never mistake it for a stripped signature.
			manifest = { ...manifestSansSig, unsigned: true };
		}
		addJson('manifest.json', manifest);

		const zip = zipSync(files, { level: 6 });
		const stamp = createdAt.replace(/[:.]/g, '-');
		this.logger.log(
			`Exported ${did.slice(0, 24)}… (${zip.length} bytes, ${assetIndex.length} assets, ` +
				`${rootSign ? 'signed' : 'unsigned data-only'})`
		);
		return { zip, filename: `slyng-identity-${account.username}-${stamp}.zip` };
	}

	/** Whether this identity's root seed is Aegis-encrypted here. A custodial
	 * account signs its export with the password-unlocked seed; a self-custody
	 * account (device-held seed) gets an unsigned data-only bundle. */
	private identityHasAegis(identity: IdentityRow): boolean {
		return !!(
			identity.aegis_salt &&
			identity.aegis_nonce &&
			identity.aegis_ct &&
			identity.aegis_tag
		);
	}

	/** Custody of the caller's own identity — the export UI reads this to decide
	 * whether to prompt for a password (custodial, signs) or export directly
	 * (self-custody, unsigned data-only). */
	async getExportInfo(did: string): Promise<{ has_aegis: boolean }> {
		const identity = await this.identities.findByDid(did);
		if (!identity) throw new HttpException('Identity not found', 404);
		return { has_aegis: this.identityHasAegis(identity) };
	}

	/** `{ local_id, record }` with the composite `id` and non-portable RecordId
	 * links stripped; Dates serialize to ISO via JSON. */
	private toExport(id: RecordId, row: Record<string, unknown>): ExportedRecord {
		const { id: _id, folder_id: _folder, ...rest } = row;
		void _id;
		void _folder;
		return { local_id: extractLocalId(id), record: rest };
	}

	/** Candidate asset URLs on a row across every known asset field. */
	private assetUrls(row: Record<string, unknown>): string[] {
		const out: string[] = [];
		const push = (v: unknown) => {
			if (typeof v === 'string' && v) out.push(v);
		};
		push(row.url);
		push(row.avatar_url);
		push(row.banner_url);
		push(row.thumbnail_url);
		push(row.image_url);
		if (Array.isArray(row.media_urls)) for (const m of row.media_urls) push(m);
		return out;
	}

	/** Strip the local S3 public base + query to get the object key, or null
	 * if the URL is foreign (a federated reference we don't own). */
	private urlToLocalKey(url: string): string | null {
		const base = this.storage.getPublicBase();
		const clean = url.split('?')[0];
		if (!clean.startsWith(base + '/')) return null;
		return clean.slice(base.length + 1);
	}

	private mimeFromKey(key: string): string {
		const ext = key.split('.').pop()?.toLowerCase() ?? '';
		const map: Record<string, string> = {
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			png: 'image/png',
			webp: 'image/webp',
			gif: 'image/gif',
			mp4: 'video/mp4',
			webm: 'video/webm',
			svg: 'image/svg+xml'
		};
		return map[ext] ?? 'application/octet-stream';
	}

	/** SHA-256 (hex) of every bundle file, keyed by its zip path — the v2
	 * manifest's integrity map. `manifest.json` is written to the archive AFTER
	 * this runs (it carries the map), so it's excluded here. Import recomputes
	 * this byte-for-byte and checks the file set + every hash. */
	private hashFiles(files: Record<string, Uint8Array>): Record<string, string> {
		const out: Record<string, string> = {};
		for (const name of Object.keys(files).sort()) {
			out[name] = createHash('sha256').update(files[name]).digest('hex');
		}
		return out;
	}
}
