import type { Request } from 'express';

/**
 * The shape `AuthGuard` attaches to the request after validating the
 * `slyng_session` cookie. Kept in one place so controllers can type `@Req()`
 * instead of falling back to `any` — a plain `express.Request` has no `user`,
 * which is why those sites were casting.
 *
 * `user` is optional because `@Public()` routes run without the guard.
 */
export interface AuthedUser {
	/** DID; `id` and `did` are the same value, both kept for existing callers. */
	id: string;
	did: string;
	delegate_public_key?: string;
	platform_token?: string;
	syr_instance_url?: string;
}

export type AuthedRequest = Request & { user?: AuthedUser };
