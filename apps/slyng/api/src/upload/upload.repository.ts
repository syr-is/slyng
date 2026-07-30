import { Injectable } from '@nestjs/common';
import type { RecordId } from 'surrealdb';
import { BaseRepository } from '../db/base.repository';
import { DbService } from '../db/db.service';

export type UploadStatus = 'pending' | 'finalizing' | 'completed' | 'failed';

/**
 * Upload bookkeeping for the presign → PUT → finalize flow. `key` and `url` are
 * only populated at finalize, so both are optional while `status` is 'pending'.
 *
 * Note `channel_id` is a `RecordId` link, not a string: the service decodes the
 * inbound id before writing. The previous declaration (in upload.service.ts)
 * said `string | null`, which never matched what was stored.
 */
export interface UploadRow extends Record<string, unknown> {
	id: RecordId;
	/** Uploader DID. */
	uploader_id: string;
	channel_id?: RecordId | null;
	filename: string;
	mime_type: string;
	size: number;
	width?: number | null;
	height?: number | null;
	key?: string;
	url?: string;
	status: UploadStatus;
	sha256?: string | null;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class UploadRepository extends BaseRepository<UploadRow> {
	protected tableName = 'upload';
	constructor(db: DbService) { super(db); }
}
