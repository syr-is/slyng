import { z } from 'zod';
import { RecordId } from 'surrealdb';

// ── Base schemas ──

export const RecordIdSchema = z.instanceof(RecordId);

export const TimestampSchema = z.object({
	created_at: z.date(),
	updated_at: z.date()
});

export const BaseEntitySchema = z
	.object({
		id: RecordIdSchema
	})
	.merge(TimestampSchema);

export type BaseEntity = z.infer<typeof BaseEntitySchema>;

// ── Pagination ──

export const PaginationSchema = z.object({
	page: z.number().int().positive(),
	limit: z.number().int().positive().max(100),
	total: z.number().int().min(0),
	total_pages: z.number().int().min(0)
});

export type Pagination = z.infer<typeof PaginationSchema>;
