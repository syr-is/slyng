import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, HeadObjectCommand, HeadBucketCommand, CreateBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { RecordId } from 'surrealdb';
import { stringToRecordId } from '@syren/types';
import { UploadRepository } from './upload.repository';

type UploadStatus = 'pending' | 'completed' | 'failed';

interface UploadRecord {
	id: RecordId;
	uploader_id: string;
	channel_id?: string | null;
	filename: string;
	mime_type: string;
	size: number;
	width?: number | null;
	height?: number | null;
	key: string;
	url: string;
	status: UploadStatus;
	sha256?: string | null;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class UploadService implements OnModuleInit {
	private readonly logger = new Logger(UploadService.name);
	private s3!: S3Client;
	private bucket!: string;
	private publicBase!: string;
	private maxBytes!: number;

	constructor(
		private readonly config: ConfigService,
		private readonly uploads: UploadRepository
	) {}

	private s3Public!: S3Client;

	onModuleInit() {
		const endpoint = this.config.get<string>('S3_ENDPOINT', 'http://localhost:8343');
		const region = this.config.get<string>('S3_REGION', 'us-east-1');
		const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID', 'syren-access-key');
		const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY', 'syren-secret-key');
		this.bucket = this.config.get<string>('S3_BUCKET', 'syren');
		const publicUrl = this.config.get<string>('S3_PUBLIC_URL', `${endpoint}/${this.bucket}`);
		this.publicBase = publicUrl.replace(/\/+$/, '');
		this.maxBytes = Number(this.config.get<string>('UPLOAD_MAX_BYTES', '524288000'));

		const creds = { accessKeyId, secretAccessKey };
		this.s3 = new S3Client({
			endpoint,
			region,
			credentials: creds,
			forcePathStyle: true,
			requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 } as any
		});
		// Public client for presigned URLs — browser needs the external endpoint
		// S3_PUBLIC_URL is like https://s3.slyng.gg/syren — strip the bucket suffix
		const publicEndpoint = new URL(publicUrl).origin;
		this.s3Public = new S3Client({
			endpoint: publicEndpoint,
			region,
			credentials: creds,
			forcePathStyle: true
		});
		this.logger.log(`Storage ready — bucket=${this.bucket} endpoint=${endpoint} publicUrl=${publicUrl}`);
		this.ensureBucket().catch((err) => this.logger.error('Failed to ensure S3 bucket', err));
	}

	private async ensureBucket() {
		try {
			await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
		} catch (err: any) {
			const status = err?.$metadata?.httpStatusCode;
			if (status !== 404 && err?.name !== 'NotFound' && err?.name !== 'NoSuchBucket') throw err;
			await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
			this.logger.log(`S3 bucket "${this.bucket}" created`);
		}
		const corsOrigins = this.config.get<string>('S3_CORS_ORIGINS', '*').split(',').map(s => s.trim()).filter(Boolean);
		await this.s3.send(new PutBucketCorsCommand({
			Bucket: this.bucket,
			CORSConfiguration: {
				CORSRules: [{
					AllowedOrigins: corsOrigins,
					AllowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
					AllowedHeaders: ['*'],
					ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'Last-Modified', 'x-amz-request-id', 'x-amz-version-id'],
					MaxAgeSeconds: 3600
				}]
			}
		}));
		this.logger.log(`S3 bucket "${this.bucket}" CORS set for: ${corsOrigins.join(', ')}`);
	}

	async requestPresign(
		userId: string,
		data: { filename: string; mime_type: string; size: number; channel_id?: string }
	) {
		if (!Number.isFinite(data.size) || data.size <= 0) {
			throw new Error('Invalid file size');
		}
		if (data.size > this.maxBytes) {
			throw new Error(`File exceeds max size of ${this.maxBytes} bytes`);
		}
		const filename = this.sanitizeFilename(data.filename);
		const now = new Date();

		const record = (await this.uploads.create({
			uploader_id: userId,
			channel_id: data.channel_id ? stringToRecordId.decode(data.channel_id) : null,
			filename,
			mime_type: data.mime_type,
			size: data.size,
			status: 'pending' as UploadStatus,
			created_at: now,
			updated_at: now
		})) as unknown as UploadRecord;

		const rid = record.id as RecordId;
		const localId = typeof rid.id === 'string' ? rid.id : String(rid.id);
		const channelSegment = data.channel_id
			? `channels/${this.sanitizeSegment(data.channel_id)}`
			: 'loose';
		// `public/` subpath is matched by the seaweedfs anonymous read ACL
		const key = `uploads/${this.sanitizeSegment(userId)}/${channelSegment}/${localId}/public/${filename}`;
		const finalUrl = `${this.publicBase}/${key}`;

		await this.uploads.merge((record.id as RecordId), {
			key,
			url: finalUrl,
			updated_at: new Date()
		});

		const signedUrl = await getSignedUrl(
			this.s3Public,
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				ContentType: data.mime_type,
				ContentLength: data.size
			}),
			{ expiresIn: 3600 }
		);

		return {
			upload_id: stringToRecordId.encode(rid),
			signed_url: signedUrl,
			final_url: finalUrl,
			max_bytes: this.maxBytes
		};
	}

	async finalize(
		uploadId: string,
		userId: string,
		data: { sha256?: string; width?: number; height?: number }
	) {
		const id = stringToRecordId.decode(uploadId);
		const record = (await this.uploads.findById(id)) as unknown as UploadRecord | null;
		if (!record) throw new Error('Upload not found');
		if (record.uploader_id !== userId) throw new Error('Not your upload');
		if (record.status === 'completed') return this.toAttachment(record);

		// Verify the object exists and matches the declared size
		let actualSize: number | undefined;
		try {
			const head = await this.s3.send(
				new HeadObjectCommand({ Bucket: this.bucket, Key: record.key })
			);
			actualSize = head.ContentLength;
		} catch (err) {
			throw new Error(`Upload verification failed: ${err instanceof Error ? err.message : 'unknown'}`);
		}

		if (actualSize !== record.size) {
			throw new Error(`Size mismatch: expected ${record.size}, got ${actualSize}`);
		}

		const patch: Record<string, unknown> = {
			status: 'completed' as UploadStatus,
			updated_at: new Date()
		};
		if (data.width && Number.isFinite(data.width)) patch.width = Math.floor(data.width);
		if (data.height && Number.isFinite(data.height)) patch.height = Math.floor(data.height);
		if (data.sha256) patch.sha256 = data.sha256;

		const updated = (await this.uploads.merge(id, patch)) as unknown as UploadRecord;
		this.logger.log(`Upload finalized ${uploadId}`);
		return this.toAttachment(updated);
	}

	async findById(uploadId: string) {
		const id = stringToRecordId.decode(uploadId);
		return (await this.uploads.findById(id)) as unknown as UploadRecord | null;
	}

	private toAttachment(record: UploadRecord) {
		return {
			url: record.url,
			filename: record.filename,
			mime_type: record.mime_type,
			size: record.size,
			width: record.width ?? undefined,
			height: record.height ?? undefined
		};
	}

	private sanitizeFilename(name: string): string {
		const fallback = 'file';
		const cleaned = (name || fallback)
			.replace(/[^\w.\-]+/g, '_')
			.replace(/_+/g, '_')
			.slice(0, 120);
		return cleaned.length > 0 ? cleaned : fallback;
	}

	private sanitizeSegment(v: string): string {
		return v.replace(/[^\w.\-:]+/g, '_').slice(0, 180);
	}
}
