import { Injectable, Logger } from '@nestjs/common';
import {
	PutObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	DeleteObjectCommand,
	type HeadObjectCommandOutput
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectStoreService } from '../storage/object-store.service';

/**
 * S3 access for owned identity content (profile assets, stories, and — in
 * later phases — posts, emojis, GIFs, library uploads). A thin wrapper over
 * presigned PUT + HeadObject + delete, keyed on caller-supplied S3 keys
 * (composite-id resources build their own `uploads/{did}/…/public/{ulid}`
 * layout). Shares the single `ObjectStoreService` (provider + clients) with
 * the chat `UploadService`; it does not own any upload table.
 */
@Injectable()
export class IdpStorageService {
	private readonly logger = new Logger(IdpStorageService.name);

	constructor(private readonly store: ObjectStoreService) {}

	buildUrl(key: string): string {
		return this.store.buildUrl(key);
	}

	/** Presigned PUT for a browser-side upload; SHA-256 (hex) enforced when given. */
	async presignPut(
		key: string,
		mimeType: string,
		sha256?: string,
		expiresIn = 3600
	): Promise<string> {
		return getSignedUrl(
			this.store.publicClient,
			new PutObjectCommand({
				Bucket: this.store.bucket,
				Key: key,
				ContentType: mimeType,
				...(sha256 && { ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64') })
			}),
			{ expiresIn }
		);
	}

	/** Presigned GET for a time-boxed share link (private library files). */
	async presignGet(key: string, expiresIn = 3600): Promise<string> {
		return getSignedUrl(
			this.store.publicClient,
			new GetObjectCommand({ Bucket: this.store.bucket, Key: key }),
			{ expiresIn }
		);
	}

	/** HeadObject with a few quick retries; null on 404, throws on other errors. */
	async headObject(
		key: string,
		maxAttempts = 3,
		delayMs = 2000
	): Promise<HeadObjectCommandOutput | null> {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			try {
				return await this.store.client.send(
					new HeadObjectCommand({ Bucket: this.store.bucket, Key: key })
				);
			} catch (err) {
				const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
					?.httpStatusCode;
				if (status === 404 && attempt < maxAttempts - 1) {
					await new Promise((r) => setTimeout(r, delayMs));
					continue;
				}
				if (status === 404) return null;
				throw err;
			}
		}
		return null;
	}

	async deleteObject(key: string): Promise<void> {
		try {
			await this.store.client.send(
				new DeleteObjectCommand({ Bucket: this.store.bucket, Key: key })
			);
		} catch (err) {
			// Best-effort — the DB row is the source of truth. Orphaned objects
			// are swept elsewhere; never fail a delete on a missing object.
			this.logger.warn(`Failed to delete object ${key}: ${(err as Error).message}`);
		}
	}

	/**
	 * Server-side PUT of an in-memory buffer (identity import re-uploads a
	 * bundle's assets to local S3). Unlike `presignPut`, the bytes flow
	 * through the API, so callers must cap the size upstream.
	 */
	async putObjectBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
		await this.store.client.send(
			new PutObjectCommand({
				Bucket: this.store.bucket,
				Key: key,
				Body: body,
				ContentType: contentType
			})
		);
	}

	/**
	 * Server-side GET of an object as a buffer (identity export bundles the
	 * raw asset bytes into the zip). Returns null on 404.
	 */
	async getObjectBuffer(key: string): Promise<Buffer | null> {
		try {
			const res = await this.store.client.send(
				new GetObjectCommand({ Bucket: this.store.bucket, Key: key })
			);
			const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
			if (!body?.transformToByteArray) return null;
			return Buffer.from(await body.transformToByteArray());
		} catch (err) {
			const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
				?.httpStatusCode;
			if (status === 404) return null;
			this.logger.warn(`Failed to read object ${key}: ${(err as Error).message}`);
			return null;
		}
	}

	/** The public S3 base URL, so import can detect + rewrite foreign asset URLs. */
	getPublicBase(): string {
		return this.store.publicBase;
	}
}
