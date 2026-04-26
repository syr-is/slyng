/**
 * `@syren/client` — typed wrapper around the syren-client WASM module.
 *
 * Usage:
 *
 *     import { initSyrenClient } from '@syren/client';
 *
 *     const client = await initSyrenClient('https://app.slyng.gg');
 *     await client.loginStart('https://app.syr.is');
 *     const me = await client.me();
 *     const servers = await client.servers.list();
 */

export { initSyrenClient } from './adapter.js';
export type {
	SyrenClient,
	Identity,
	LoginResponse,
	Json
} from './adapter.js';
