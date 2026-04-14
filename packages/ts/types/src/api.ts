import { z } from 'zod';
import { PaginationSchema } from './common.js';

// ── API response format (matches syr convention) ──

export const APIErrorSchema = z.object({
	code: z.string(),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional()
});

export type APIError = z.infer<typeof APIErrorSchema>;

export function APIResponseSchema<T extends z.ZodType>(dataSchema: T) {
	return z.object({
		status: z.number(),
		data: dataSchema.optional(),
		error: APIErrorSchema.optional(),
		meta: z.record(z.string(), z.unknown()).optional()
	});
}

export function PaginatedResponseSchema<T extends z.ZodType>(dataSchema: T) {
	return z.object({
		status: z.number(),
		data: z.array(dataSchema),
		pagination: PaginationSchema,
		error: APIErrorSchema.optional()
	});
}

// ── OAuth types ──

export const OAuthTokenResponseSchema = z.object({
	access_token: z.string(),
	token_type: z.literal('Bearer'),
	expires_in: z.number(),
	refresh_token: z.string().optional(),
	scope: z.string().optional()
});

export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

export const OAuthUserInfoSchema = z.object({
	sub: z.string(),
	name: z.string().optional(),
	preferred_username: z.string().optional(),
	picture: z.string().optional(),
	profile: z.string().optional()
});

export type OAuthUserInfo = z.infer<typeof OAuthUserInfoSchema>;
