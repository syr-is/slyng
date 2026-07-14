import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { serializeForWire } from './serialize';

/**
 * Serializes SurrealDB types in HTTP responses. Walking logic lives in
 * `serializeForWire` (shared with the WS gateway) so both surfaces emit
 * the same wire shape.
 */
@Injectable()
export class RecordIdInterceptor implements NestInterceptor {
	intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
		return next.handle().pipe(map((data) => serializeForWire(data)));
	}
}
