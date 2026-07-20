import { HttpException, Injectable, Logger } from '@nestjs/common';
import { unzipSync, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import {
	canonicalize,
	decodeMultibase,
	decodePublicKey,
	deriveDid,
	parseDid,
	sign,
	verify,
	verifyRotationChain
} from '@slyng/idp-crypto';
import type {
	AegisBundle,
	IdentityExportManifest,
	IdentityImportResult,
	RotationStatement
} from '@slyng/types';
import { IdentityExportManifestSchema } from '@slyng/types';
import { AccountService } from './account.service';
import { IdpCryptoService } from './idp-crypto.service';
import { IdpStorageService } from './idp-storage.service';
import { IdentityRepository, IdpProfileRepository, LocalAccountRepository } from './idp.repository';
import { IdentityRotationRepository } from './idp-rotation.repository';
import { rootKeyMultibase } from './root-key.service';
import { PostRepository } from './idp-post.repository';
import { EmojiRepository, GifRepository } from './idp-media.repository';
import { LibraryUploadRepository } from './idp-content.repository';
import { CommentRepository, ReactionRepository, FollowRepository } from './idp-interaction.repository';
import type { CompositeIdRepository } from '../db/composite.repository';

interface ExportedRecord {
	local_id: string;
	record: Record<string, unknown>;
}

interface ParsedBundle {
	manifest: IdentityExportManifest;
	files: Record<string, Uint8Array>;
	/** The root key the bundle signature verified against — the CURRENT root at
	 * export time (chain-resolved), or genesis for an un-rotated/legacy bundle. */
	rootKey: Uint8Array;
	/** The bundle's embedded rotation chain (empty for un-rotated identities). */
	rotationChain: RotationStatement[];
}

const DATE_FIELDS = ['created_at', 'updated_at', 'published_at'];
/** Defence-in-depth against decompression bombs on the public import endpoint:
 * cap the declared total uncompressed size + entry count before inflating. */
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_ENTRIES = 10_000;

/**
 * Identity import (P11): validate + ingest a signed export bundle. The bundle
 * is authenticated end-to-end — the recomputed content digest must match the
 * manifest, and the manifest's `{did, content_digest, exported_at}` must carry
 * a valid root signature from the DID's key. Assets are re-uploaded to local
 * S3 under their original keys (the DID is stable, so keys are too) and every
 * record URL is rewritten from the source host to ours. Composite ULIDs are
 * preserved, so cross-record links survive and re-import is idempotent.
 */
@Injectable()
export class IdentityImportService {
	private readonly logger = new Logger(IdentityImportService.name);

	constructor(
		private readonly accountService: AccountService,
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
		private readonly rotations: IdentityRotationRepository
	) {}

	/**
	 * Register a brand-new account FROM an export bundle (identity migration).
	 * The bundle must carry the Aegis seed; the password must decrypt it and
	 * bind to the bundle DID. Creates the account under the SAME DID, then
	 * ingests all content. 409 if the DID already exists here.
	 */
	async registerWithImport(
		zip: Uint8Array,
		username: string,
		password: string,
		inviteCode?: string
	): Promise<{ did: string; sessionId: string; bridge: string; imported: IdentityImportResult }> {
		const bundle = await this.parseAndVerify(zip);
		const { manifest, files, rootKey, rotationChain } = bundle;

		const identityFile = this.readJson<{
			did: string;
			public_key: string;
			aegis?: AegisBundle & { kdf: { mem: number; it: number; par: number } };
		}>(files, 'identity.json');
		if (!identityFile?.aegis?.ct) {
			throw new HttpException(
				'This bundle has no encrypted seed — import it after signing in with your device (self-custody).',
				400
			);
		}

		const aegisBundle: AegisBundle = {
			pub: manifest.public_key,
			salt: identityFile.aegis.salt,
			nonce: identityFile.aegis.nonce,
			ct: identityFile.aegis.ct,
			tag: identityFile.aegis.tag,
			kdf: identityFile.aegis.kdf
		};

		// Prove the password owns the seed AND the seed binds to the CURRENT root
		// (chain-resolved): sign a probe with the decrypted seed, verify it under
		// the bundle's root key. For a rotated identity the Aegis seed is the new
		// root, so this must verify against the chain head, not the genesis key.
		await this.assertSeedOwnership(aegisBundle, password, manifest, rootKey);

		const provisioned = await this.accountService.provisionImportedAccount({
			username,
			password,
			did: manifest.did,
			publicKey: manifest.public_key,
			aegisBundle,
			displayName: this.readJson<{ display_name?: string }>(files, 'profile.json')?.display_name,
			inviteCode
		});

		// Ingest the rotation chain (P12) so the restored identity's current root
		// (chain head) matches its imported Aegis seed. The (did, seq) unique
		// index makes this idempotent on a re-run.
		await this.ingestRotationChain(manifest.did, rotationChain);

		const imported = await this.ingest(manifest.did, files, { includeProfile: true });
		return { ...provisioned, imported };
	}

	/** Insert a bundle's rotation-chain rows, skipping any that already exist. */
	private async ingestRotationChain(did: string, chain: RotationStatement[]): Promise<void> {
		for (const s of chain) {
			if (s.did !== did) continue;
			try {
				await this.rotations.appendRotation({
					did,
					seq: s.seq,
					prevRoot: s.prevRoot,
					newRoot: s.newRoot,
					rotatedAt: s.rotatedAt,
					signature: s.signature,
					now: new Date()
				});
			} catch (err) {
				// A duplicate (did, seq) means the row is already present — fine.
				this.logger.debug(
					`Import: rotation seq ${s.seq} for ${did.slice(0, 16)}… not inserted: ${(err as Error).message}`
				);
			}
		}
	}

	/**
	 * Restore/merge a bundle into the CURRENT account. The bundle DID must
	 * match the session DID (you can only import your own backup). Content is
	 * upserted; the identity/seed/account are untouched.
	 */
	async importIntoExisting(sessionDid: string, zip: Uint8Array): Promise<IdentityImportResult> {
		const { manifest, files } = await this.parseAndVerify(zip);
		if (manifest.did !== sessionDid) {
			throw new HttpException('This bundle belongs to a different identity', 403);
		}
		const account = await this.accounts.findByDid(sessionDid);
		if (!account) throw new HttpException('Account not found', 404);
		return this.ingest(sessionDid, files, { includeProfile: true });
	}

	// ── Verification ──────────────────────────────────────────────────────

	private async parseAndVerify(zip: Uint8Array): Promise<ParsedBundle> {
		let files: Record<string, Uint8Array>;
		try {
			let total = 0;
			let count = 0;
			files = unzipSync(zip, {
				filter: (f) => {
					count += 1;
					total += f.originalSize;
					if (count > MAX_ENTRIES || total > MAX_UNCOMPRESSED_BYTES) {
						throw new Error('bundle exceeds size limits');
					}
					return true;
				}
			});
		} catch {
			throw new HttpException('Invalid or oversized zip archive', 400);
		}
		const manifestRaw = this.readJson<unknown>(files, 'manifest.json');
		if (!manifestRaw) throw new HttpException('Bundle is missing manifest.json', 400);
		const parsed = IdentityExportManifestSchema.safeParse(manifestRaw);
		if (!parsed.success) throw new HttpException('Bundle manifest is malformed', 400);
		const manifest = parsed.data;

		if (!parseDid(manifest.did)) throw new HttpException('Bundle DID is invalid', 400);

		// 1. Content integrity: recompute the digest over every file except the
		//    manifest + signature and require an exact match.
		const recomputed = this.digestFiles(files);
		if (recomputed !== manifest.content_digest) {
			throw new HttpException('Bundle content digest mismatch — archive is corrupt or tampered', 400);
		}

		// 2. Trust anchor (P12): resolve the key the bundle was signed under. For
		//    a rotated identity that is the CURRENT root at export time, proven by
		//    the chain embedded in identity.json (which self-verifies offline);
		//    for an un-rotated / legacy bundle it is the genesis (DID) key.
		const { rootKey, rotationChain } = this.resolveBundleRootKey(manifest, files);

		// 3. Authenticity: the digest payload must be signed by that root key.
		const sigFile = files['export.sig'];
		if (!sigFile) throw new HttpException('Bundle is missing export.sig', 400);
		const signature = strFromU8(sigFile);
		const payload = canonicalize({
			did: manifest.did,
			content_digest: manifest.content_digest,
			exported_at: manifest.exported_at
		});
		let ok = false;
		try {
			ok = await verify(payload, decodeMultibase(signature), rootKey);
		} catch {
			ok = false;
		}
		if (!ok) throw new HttpException('Bundle signature does not verify against its root key', 400);

		return { manifest, files, rootKey, rotationChain };
	}

	/**
	 * Resolve the root key a bundle was signed under (P12), and its embedded
	 * rotation chain. When the manifest declares a `signing_key`, the chain in
	 * `identity.json` is verified and MUST resolve to that key — so a crafted
	 * bundle cannot claim an arbitrary signing key. Absent a `signing_key`, the
	 * bundle is treated as un-rotated and verified against the genesis key.
	 */
	private resolveBundleRootKey(
		manifest: IdentityExportManifest,
		files: Record<string, Uint8Array>
	): { rootKey: Uint8Array; rotationChain: RotationStatement[] } {
		const identityFile = this.readJson<{ rotation_chain?: RotationStatement[] }>(
			files,
			'identity.json'
		);
		const rotationChain = Array.isArray(identityFile?.rotation_chain)
			? identityFile!.rotation_chain
			: [];

		if (!manifest.signing_key) {
			// Un-rotated / legacy bundle → genesis (DID-deriving) key.
			return { rootKey: parseDid(manifest.did).publicKey, rotationChain };
		}

		let resolved: Uint8Array;
		try {
			resolved = verifyRotationChain(manifest.did, rotationChain);
		} catch (err) {
			throw new HttpException(
				`Bundle rotation chain is invalid: ${(err as Error).message}`,
				400
			);
		}
		if (rootKeyMultibase(resolved) !== manifest.signing_key) {
			throw new HttpException('Bundle signing key does not match its rotation chain', 400);
		}
		return { rootKey: resolved, rotationChain };
	}

	/** Sign a probe with the decrypted seed and verify it against the manifest
	 * key — proves the password unlocks a seed that really owns this DID. */
	private async assertSeedOwnership(
		bundle: AegisBundle,
		password: string,
		manifest: IdentityExportManifest,
		rootKey: Uint8Array
	): Promise<void> {
		// public_key must derive the claimed DID (it is the immutable genesis key).
		let derived: string;
		try {
			derived = deriveDid(decodePublicKey(manifest.public_key));
		} catch {
			throw new HttpException('Bundle public key is malformed', 400);
		}
		if (derived !== manifest.did) {
			throw new HttpException('Bundle public key does not match its DID', 400);
		}

		const probe = 'slyng-import-ownership-probe';
		let sig: Uint8Array;
		try {
			sig = await this.crypto.withSeed({ bundle, password, action: (seed) => sign(probe, seed) });
		} catch {
			throw new HttpException('Incorrect password for this bundle', 401);
		}
		// Verify against the CURRENT root (chain-resolved) — the encrypted seed is
		// the current root's private key, which is the new root after any rotation.
		const valid = await verify(probe, sig, rootKey);
		if (!valid) throw new HttpException('Seed does not match the bundle root key', 400);
	}

	// ── Ingestion ───────────────────────────────────────────────────────

	private async ingest(
		did: string,
		files: Record<string, Uint8Array>,
		opts: { includeProfile: boolean }
	): Promise<IdentityImportResult> {
		// Re-upload assets first, building key → local URL for rewriting.
		const assetIndex = this.readJson<Array<{ key: string; mime: string }>>(files, 'assets.json') ?? [];
		const urlMap = new Map<string, string>();
		const base = this.storage.getPublicBase();
		// Assets are only ever written under the bundle owner's own prefix. A
		// crafted bundle must NOT be able to overwrite another DID's objects or
		// traverse outside the uploads namespace.
		const ownedPrefix = `uploads/${did}/`;
		for (const { key } of assetIndex) {
			if (typeof key !== 'string' || !key.startsWith(ownedPrefix) || key.includes('..')) {
				this.logger.warn(`Import ${did.slice(0, 16)}…: rejected foreign/unsafe asset key ${key}`);
				continue;
			}
			const bytes = files[`assets/${key}`];
			if (!bytes) continue;
			// Derive the stored Content-Type from the key extension — never trust
			// the bundle's declared mime (a crafted text/html would be a stored-XSS
			// vector when served from the public S3 base).
			await this.storage.putObjectBuffer(key, Buffer.from(bytes), this.mimeFromKey(key));
			urlMap.set(key, `${base}/${key}`);
		}

		const counts = {
			posts: await this.ingestRecords(this.posts, did, files, 'records/posts.json', urlMap),
			stories: await this.ingestRecords(this.uploads, did, files, 'records/stories.json', urlMap),
			uploads: await this.ingestRecords(this.uploads, did, files, 'records/uploads.json', urlMap),
			emojis: await this.ingestRecords(this.emojis, did, files, 'records/emojis.json', urlMap),
			gifs: await this.ingestRecords(this.gifs, did, files, 'records/gifs.json', urlMap),
			comments: await this.ingestRecords(this.comments, did, files, 'records/comments.json', urlMap),
			reactions: await this.ingestRecords(this.reactions, did, files, 'records/reactions.json', urlMap),
			follows: await this.ingestRecords(this.follows, did, files, 'records/follows.json', urlMap),
			registries: 0,
			assets: urlMap.size
		};

		if (opts.includeProfile) {
			const profile = this.readJson<Record<string, unknown>>(files, 'profile.json');
			if (profile) {
				const account = await this.accounts.findByDid(did);
				if (account) {
					const rewritten = this.rewriteUrls(profile, urlMap);
					await this.profiles.mergeByAccountId(account.id, {
						display_name: (rewritten.display_name as string) ?? undefined,
						bio: (rewritten.bio as string) ?? undefined,
						avatar_url: (rewritten.avatar_url as string) ?? undefined,
						banner_url: (rewritten.banner_url as string) ?? undefined,
						updated_at: new Date()
					});
				}
			}
		}

		this.logger.log(
			`Imported into ${did.slice(0, 24)}…: ${counts.posts}p ${counts.emojis}e ${counts.gifs}g ` +
				`${counts.stories}st ${counts.uploads}u ${counts.comments}c ${counts.reactions}r ${counts.follows}f`
		);
		return { did, imported: counts };
	}

	private async ingestRecords(
		repo: CompositeIdRepository<Record<string, unknown>>,
		did: string,
		files: Record<string, Uint8Array>,
		name: string,
		urlMap: Map<string, string>
	): Promise<number> {
		const rows = this.readJson<ExportedRecord[]>(files, name);
		if (!Array.isArray(rows)) return 0;
		let n = 0;
		for (const { local_id, record } of rows) {
			if (!local_id || !record) continue;
			const data = this.reviveDates(this.rewriteUrls(this.sanitizeRecord(record), urlMap));
			try {
				const existing = await repo.findByComposite(did, local_id);
				if (existing) {
					await repo.mergeByComposite(did, local_id, data);
				} else {
					await repo.createWithExplicitId(did, local_id, data);
				}
				n++;
			} catch (err) {
				this.logger.warn(`Import: failed ${name} ${local_id}: ${(err as Error).message}`);
			}
		}
		return n;
	}

	// ── Helpers ───────────────────────────────────────────────────────

	private readJson<T>(files: Record<string, Uint8Array>, name: string): T | null {
		const raw = files[name];
		if (!raw) return null;
		try {
			return JSON.parse(strFromU8(raw)) as T;
		} catch {
			return null;
		}
	}

	/** Byte-identical to IdentityExportService.digestFiles — length-prefixed
	 * (name len + byte len, u32 BE) so no name/content boundary shift collides. */
	private digestFiles(files: Record<string, Uint8Array>): string {
		const hash = createHash('sha256');
		for (const name of Object.keys(files).sort()) {
			if (name === 'manifest.json' || name === 'export.sig') continue;
			const nameBuf = Buffer.from(name, 'utf8');
			const lens = Buffer.alloc(8);
			lens.writeUInt32BE(nameBuf.length, 0);
			lens.writeUInt32BE(files[name].length, 4);
			hash.update(lens);
			hash.update(nameBuf);
			hash.update(files[name]);
		}
		return hash.digest('hex');
	}

	/**
	 * Rewrite any source-host asset URL to the local one, by object key. The
	 * match is bounded to a single URL token — no whitespace, quotes, parens or
	 * angle brackets — so it can't swallow surrounding prose in a post body, and
	 * catches markdown-embedded `![](…)` URLs too. Longest keys first so a key
	 * that is a prefix of another never truncates it.
	 */
	private rewriteUrls(record: Record<string, unknown>, urlMap: Map<string, string>): Record<string, unknown> {
		if (urlMap.size === 0) return record;
		let json = JSON.stringify(record);
		const keys = [...urlMap.keys()].sort((a, b) => b.length - a.length);
		for (const key of keys) {
			const re = new RegExp(
				'https?://[^\\s"\'\\\\)<>]*?' + this.escapeRegExp(key) + '(\\?[^\\s"\'\\\\)<>]*)?',
				'g'
			);
			json = json.replace(re, urlMap.get(key)!);
		}
		return JSON.parse(json) as Record<string, unknown>;
	}

	/** Drop composite/ownership-authoritative fields — the record's identity is
	 * always rebuilt from the importer's DID + the preserved local_id, never
	 * from bundle-supplied `id`/`created_by`/owner fields. */
	private sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
		const out = { ...record };
		for (const f of ['id', 'created_by', 'owner_id', 'account_id', 'folder_id']) delete out[f];
		return out;
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

	private reviveDates(record: Record<string, unknown>): Record<string, unknown> {
		const out = { ...record };
		for (const f of DATE_FIELDS) {
			if (typeof out[f] === 'string') {
				const d = new Date(out[f] as string);
				if (!Number.isNaN(d.getTime())) out[f] = d;
			}
		}
		return out;
	}

	private escapeRegExp(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
