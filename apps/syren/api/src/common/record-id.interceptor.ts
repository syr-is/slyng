import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Serializes SurrealDB types in API responses.
 *
 * RecordId (has .tb and .id) → "table:id"
 * Date → ISO string
 */
@Injectable()
export class RecordIdInterceptor implements NestInterceptor {
	intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
		return next.handle().pipe(map((data) => this.serialize(data)));
	}

	private serialize(data: unknown): unknown {
		if (data === null || data === undefined) return data;
		if (data instanceof Date) return data.toISOString();

		if (typeof data !== 'object') return data;
		if (Array.isArray(data)) return data.map((item) => this.serialize(item));

		const obj = data as Record<string, unknown>;

		// RecordId: has 'tb' (table) and 'id' (identifier) — serialize to "table:id"
		if ('tb' in obj && 'id' in obj && typeof obj.tb === 'string' && Object.keys(obj).length === 2) {
			return `${obj.tb}:${obj.id}`;
		}

		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = this.serialize(value);
		}
		return result;
	}
}
