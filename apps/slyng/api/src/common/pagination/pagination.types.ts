/**
 * Shared option-bag shapes for paginated service methods. Controllers
 * hydrate these via `@PaginatedQuery()`; services receive them directly.
 */

export interface PaginationOptions {
	limit?: number;
	offset?: number;
	sort?: string;
	order?: 'asc' | 'desc';
	q?: string;
}

export interface DateRangeOptions extends PaginationOptions {
	since?: Date;
	until?: Date;
}
