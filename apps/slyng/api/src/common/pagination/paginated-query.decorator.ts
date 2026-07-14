import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { parseIntOr, parseDate, firstString } from './pagination.util';
import { normalizeOrder } from './order';
import type { PaginationOptions, DateRangeOptions } from './pagination.types';

/**
 * Resolves the shared pagination / search query params (`limit`, `offset`,
 * `sort`, `order`, `q`) into a typed `PaginationOptions`. Pass
 * `{ dateRange: true }` to additionally parse `since` and `until` into
 * `Date` instances on a `DateRangeOptions`.
 *
 * Endpoint-specific filters (e.g. `sender_id`, `action`, `channel_id`)
 * stay as explicit `@Query('…')` params — this decorator only swallows
 * the common set.
 *
 * Defaults mirror the old per-controller helpers: `limit = 50`,
 * `offset = 0`. `order` is coerced to `undefined` when not 'asc' / 'desc'.
 */
export const PaginatedQuery = createParamDecorator(
	(
		opts: { dateRange?: boolean; defaultLimit?: number } | undefined,
		ctx: ExecutionContext
	): PaginationOptions | DateRangeOptions => {
		const req = ctx.switchToHttp().getRequest();
		const query = (req?.query ?? {}) as Record<string, unknown>;

		const base: PaginationOptions = {
			limit: parseIntOr(query.limit, opts?.defaultLimit ?? 50),
			offset: parseIntOr(query.offset, 0),
			sort: firstString(query.sort),
			order: normalizeOrder(query.order),
			q: firstString(query.q)
		};

		if (opts?.dateRange) {
			return {
				...base,
				since: parseDate(query.since),
				until: parseDate(query.until)
			} satisfies DateRangeOptions;
		}
		return base;
	}
);
