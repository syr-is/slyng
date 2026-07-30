import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
	S3Client,
	HeadBucketCommand,
	CreateBucketCommand,
	PutBucketCorsCommand
} from '@aws-sdk/client-s3';

type Provider = 'minio' | 'seaweedfs';

/**
 * Single owner of the S3 object store — mirrors syr's `object-store.ts`
 * (`apps/syr/app/src/lib/services/object-store.ts`). Both the chat
 * `UploadService` and the IdP `IdpStorageService` delegate their S3 clients
 * and boot-time setup here so the provider-specific quirks live in one place.
 *
 * Provider is chosen by `S3_PROVIDER` (`minio` | `seaweedfs`), default `minio`.
 *
 * MinIO specifics carried over from syr:
 *  - The AWS SDK v3 default checksum (`x-amz-checksum-crc32` …) is disabled via
 *    `request/responseChecksumCalculation: 'WHEN_REQUIRED'` — MinIO rejects it,
 *    which otherwise breaks presigned browser PUTs.
 *  - Bucket creation + the anonymous public-read policy are applied through the
 *    native `minio` client, because the AWS SDK sends checksum headers MinIO
 *    rejects on those admin ops. The policy replaces SeaweedFS's
 *    `s3_config.json` anonymous identity.
 *  - CORS is handled natively by MinIO's `MINIO_API_CORS_ALLOW_ORIGIN` env,
 *    so no `PutBucketCors` is issued for MinIO (SeaweedFS still gets it here).
 */
@Injectable()
export class ObjectStoreService implements OnModuleInit {
	private readonly logger = new Logger(ObjectStoreService.name);

	readonly provider: Provider;
	readonly bucket: string;
	readonly publicBase: string;
	readonly region: string;

	/** Internal client — server-side ops against the reachable endpoint. */
	readonly client: S3Client;
	/** Public client — signs presigned URLs against the browser-facing origin. */
	readonly publicClient: S3Client;

	private readonly endpoint: string;
	private readonly accessKeyId: string;
	private readonly secretAccessKey: string;
	private readonly corsOrigins: string[];

	constructor(config: ConfigService) {
		this.provider = (config.get<string>('S3_PROVIDER', 'minio') as Provider) || 'minio';
		this.endpoint = config.get<string>('S3_ENDPOINT', 'http://localhost:8343');
		this.region = config.get<string>('S3_REGION', 'us-east-1');
		this.accessKeyId = config.get<string>('S3_ACCESS_KEY_ID', 'slyng-access-key');
		this.secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY', 'slyng-secret-key');
		this.bucket = config.get<string>('S3_BUCKET', 'slyng');

		const publicUrl = config.get<string>('S3_PUBLIC_URL', `${this.endpoint}/${this.bucket}`);
		this.publicBase = publicUrl.replace(/\/+$/, '');
		this.corsOrigins = config
			.get<string>('S3_CORS_ORIGINS', '*')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		// Internal client keeps the tight dev timeouts the services used before.
		this.client = this.makeClient(this.endpoint, {
			requestTimeout: 10_000,
			connectionTimeout: 5_000
		});
		// Presigned URLs must point at the browser-reachable origin.
		this.publicClient = this.makeClient(new URL(publicUrl).origin);
	}

	onModuleInit() {
		this.logger.log(
			`ObjectStore(${this.provider}) — bucket=${this.bucket} endpoint=${this.endpoint} publicUrl=${this.publicBase}`
		);
		void this.initialize().catch((err) =>
			this.logger.error('Failed to initialize object store', err as Error)
		);
	}

	/** Public S3 URL for a stored key. */
	buildUrl(key: string): string {
		return `${this.publicBase}/${key}`;
	}

	private makeClient(endpoint: string, timeouts?: { requestTimeout: number; connectionTimeout: number }): S3Client {
		return new S3Client({
			endpoint,
			region: this.region,
			credentials: { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey },
			forcePathStyle: true,
			// MinIO rejects the SDK's automatic checksum headers — only compute
			// a checksum when the caller explicitly asks for one.
			...(this.provider === 'minio'
				? {
						requestChecksumCalculation: 'WHEN_REQUIRED' as const,
						responseChecksumValidation: 'WHEN_REQUIRED' as const
					}
				: {}),
			...(timeouts ? { requestHandler: timeouts as never } : {})
		});
	}

	// ── Boot-time setup (idempotent, once per process) ──

	private initPromise: Promise<void> | null = null;
	initialize(): Promise<void> {
		if (!this.initPromise) {
			this.initPromise = this.doInitialize().catch((err) => {
				this.initPromise = null;
				throw err;
			});
		}
		return this.initPromise;
	}

	private async doInitialize(): Promise<void> {
		if (this.provider === 'minio') {
			await this.initMinio();
		} else {
			await this.ensureBucketAws();
			await this.applyCorsAws();
		}
	}

	/** MinIO: bucket + anonymous public-read policy via the native client. */
	private async initMinio(): Promise<void> {
		const mod = (await import('minio')) as unknown as {
			Client?: new (opts: unknown) => MinioClient;
			default?: { Client?: new (opts: unknown) => MinioClient };
		};
		const MinioClientCtor = mod.Client ?? mod.default?.Client;
		if (!MinioClientCtor) throw new Error('minio: Client constructor not found');

		const url = new URL(this.endpoint);
		const mc = new MinioClientCtor({
			endPoint: url.hostname,
			port: Number(url.port) || (url.protocol === 'https:' ? 443 : 9000),
			useSSL: url.protocol === 'https:',
			accessKey: this.accessKeyId,
			secretKey: this.secretAccessKey
		});

		const exists = await mc.bucketExists(this.bucket);
		if (!exists) {
			await mc.makeBucket(this.bucket, this.region);
			this.logger.log(`S3 bucket "${this.bucket}" created`);
		}

		// Anonymous read on the `/public/` object paths — replaces SeaweedFS's
		// `s3_config.json` anonymous identity. `*` in a resource ARN spans `/`,
		// so these two patterns cover every depth (profile, stories, channel
		// attachments) under `uploads/did:syr:*/…/public/*`.
		const policy = JSON.stringify({
			Version: '2012-10-17',
			Statement: [
				{
					Sid: 'PublicUploads',
					Effect: 'Allow',
					Principal: { AWS: ['*'] },
					Action: ['s3:GetObject'],
					Resource: [
						`arn:aws:s3:::${this.bucket}/uploads/did:syr:*/public/*`,
						`arn:aws:s3:::${this.bucket}/uploads/did:syr:*/*/public/*`,
						// Server-owned emoji/sticker/gif sets (server-native, not federated).
						`arn:aws:s3:::${this.bucket}/servers/*/public/*`,
						`arn:aws:s3:::${this.bucket}/servers/*/*/public/*`
					]
				}
			]
		});
		await mc.setBucketPolicy(this.bucket, policy);
		this.logger.log(`MinIO: public-read policy applied to bucket "${this.bucket}"`);
	}

	private async ensureBucketAws(): Promise<void> {
		try {
			await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
		} catch (err) {
			const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
			const notFound =
				e?.$metadata?.httpStatusCode === 404 ||
				e?.name === 'NotFound' ||
				e?.name === 'NoSuchBucket';
			if (!notFound) throw err;
			await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
			this.logger.log(`S3 bucket "${this.bucket}" created`);
		}
	}

	private async applyCorsAws(): Promise<void> {
		await this.client.send(
			new PutBucketCorsCommand({
				Bucket: this.bucket,
				CORSConfiguration: {
					CORSRules: [
						{
							AllowedOrigins: this.corsOrigins,
							AllowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
							AllowedHeaders: ['*'],
							ExposeHeaders: [
								'ETag',
								'Content-Length',
								'Content-Type',
								'Last-Modified',
								'x-amz-request-id',
								'x-amz-version-id'
							],
							MaxAgeSeconds: 3600
						}
					]
				}
			})
		);
		this.logger.log(`S3 bucket "${this.bucket}" CORS set for: ${this.corsOrigins.join(', ')}`);
	}
}

/** Minimal shape of the bits of the native `minio` client we use. */
interface MinioClient {
	bucketExists(bucket: string): Promise<boolean>;
	makeBucket(bucket: string, region: string): Promise<void>;
	setBucketPolicy(bucket: string, policy: string): Promise<void>;
}
