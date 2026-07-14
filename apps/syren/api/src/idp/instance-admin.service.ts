import { Injectable } from '@nestjs/common';
import type { InstanceUsersPage, OwnedUploadsPage } from '@syren/types';
import { LibraryUploadRepository } from './idp-content.repository';
import { LibraryService } from './library.service';
import { LocalAccountRepository } from './idp.repository';

const SORTABLE_USER_FIELDS = new Set(['username', 'created_at', 'role']);

/**
 * Instance-admin browsing (admin-guarded at the controller): a paginated local
 * user table annotated with each account's storage use + file count, and a
 * read-through into any user's file library. Storage stats are computed per
 * page (one small aggregate per row) rather than maintained as a counter.
 */
@Injectable()
export class InstanceAdminService {
	constructor(
		private readonly accounts: LocalAccountRepository,
		private readonly uploads: LibraryUploadRepository,
		private readonly library: LibraryService
	) {}

	async listUsers(opts: {
		q?: string;
		role?: 'USER' | 'ADMIN';
		sort?: string;
		order?: 'asc' | 'desc';
		limit: number;
		offset: number;
	}): Promise<InstanceUsersPage> {
		const sort = SORTABLE_USER_FIELDS.has(opts.sort ?? '')
			? { field: opts.sort as string, order: opts.order ?? 'asc' }
			: { field: 'created_at', order: 'desc' as const };

		const { items, total } = await this.accounts.findPage(
			opts.role ? { role: opts.role } : {},
			{
				search: opts.q ? { fields: ['username'], query: opts.q } : undefined,
				sort,
				limit: opts.limit,
				offset: opts.offset
			}
		);

		const rows = await Promise.all(
			items.map(async (a) => {
				const stats = a.did ? await this.uploads.statsByDid(a.did) : { bytes: 0, files: 0 };
				return {
					did: a.did ?? '',
					username: a.username,
					role: a.role,
					created_at: new Date(a.created_at).toISOString(),
					storage_bytes: stats.bytes,
					file_count: stats.files
				};
			})
		);
		return { items: rows, total };
	}

	/** Every library file a given user has (all folders), paginated + searchable. */
	async listUserFiles(
		did: string,
		opts: {
			search?: string;
			sort?: string;
			order?: 'asc' | 'desc';
			limit: number;
			offset: number;
		}
	): Promise<OwnedUploadsPage> {
		return this.library.listFiles(did, {
			folderId: undefined, // flatten across folders for the admin view
			search: opts.search,
			sort: opts.sort,
			order: opts.order,
			limit: opts.limit,
			offset: opts.offset
		});
	}
}
