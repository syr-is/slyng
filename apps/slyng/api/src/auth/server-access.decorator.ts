import { SetMetadata } from '@nestjs/common';

export const SKIP_SERVER_ACCESS_KEY = 'skipServerAccess';

/**
 * Marker for endpoints that must accept calls from users who are NOT yet
 * members of the target server (e.g. invite preview / join). The server
 * access guard skips membership + ban checks when this is present.
 */
export const SkipServerAccess = () => SetMetadata(SKIP_SERVER_ACCESS_KEY, true);
