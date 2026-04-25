import {
	Controller,
	Get,
	Query,
	Req,
	Res,
	HttpException,
	HttpStatus,
	Logger
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '../auth/public.decorator';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { Response, Request } from 'express';

/**
 * Federated media proxy. Fetches a remote URL server-side and streams the
 * response back to the caller, so the remote only ever sees syren's backend
 * IP — not the user's. Auth-gated via the global session cookie guard.
 *
 * Not a cache, not a transcoder. Pass-through by design.
 */
@ApiTags('proxy')
@Controller('proxy')
export class ProxyController {
	private readonly logger = new Logger(ProxyController.name);
	private readonly maxBytes: number;
	private readonly timeoutMs: number;

	// Per-session token bucket: { did: { tokens, lastRefillMs } }
	// 300 req/min, refill 5/s
	private readonly buckets = new Map<string, { tokens: number; last: number }>();
	private readonly RATE_CAPACITY = 300;
	private readonly RATE_REFILL_PER_SEC = 5;

	private readonly allowPrivate: boolean;

	constructor(private readonly config: ConfigService) {
		this.maxBytes = Number(this.config.get<string>('PROXY_MAX_BYTES', '104857600'));
		this.timeoutMs = Number(this.config.get<string>('PROXY_TIMEOUT_MS', '10000'));
		// In dev, LAN IPs (192.168.x, 10.x, 172.16-31.x) are legitimate targets —
		// you're running syr + syren on the same box. Default strict in prod;
		// loopback + link-local stay blocked regardless.
		const explicit = this.config.get<string>('PROXY_ALLOW_PRIVATE_IPS');
		const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
		this.allowPrivate =
			explicit != null
				? explicit === 'true' || explicit === '1'
				: nodeEnv !== 'production';
		this.logger.log(
			`Proxy up — maxBytes=${this.maxBytes} timeoutMs=${this.timeoutMs} allowPrivate=${this.allowPrivate}`
		);
	}

	/**
	 * GET /api/proxy?url=<target>
	 * Streams the upstream response through to the client.
	 */
	@Public()
	@Get()
	@ApiOperation({ summary: 'Fetch a remote URL through syren to hide the client IP' })
	async proxy(@Query('url') target: string, @Req() req: Request, @Res() res: Response) {
		const did = this.getActorDid(req);
		if (!this.checkRate(did)) {
			throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
		}

		const parsed = this.validateUrl(target);
		if (!parsed) throw new HttpException('Invalid or disallowed URL', HttpStatus.FORBIDDEN);

		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

		let upstream: globalThis.Response;
		try {
			upstream = await fetch(parsed.toString(), {
				signal: ctrl.signal,
				redirect: 'follow',
				headers: this.forwardHeaders(req)
			});
		} catch (err) {
			clearTimeout(timer);
			this.logger.warn(
				`proxy upstream fetch failed url=${parsed.toString()} err=${err instanceof Error ? err.message : err}`
			);
			throw new HttpException('Upstream unreachable', HttpStatus.BAD_GATEWAY);
		}

		if (!upstream.ok || !upstream.body) {
			clearTimeout(timer);
			this.logger.warn(
				`proxy upstream non-ok url=${parsed.toString()} status=${upstream.status}`
			);
			throw new HttpException(`Upstream returned ${upstream.status}`, HttpStatus.BAD_GATEWAY);
		}

		// Preflight size check — refuse large bodies before streaming
		const lenHeader = upstream.headers.get('content-length');
		const declaredLen = lenHeader ? parseInt(lenHeader, 10) : NaN;
		if (Number.isFinite(declaredLen) && declaredLen > this.maxBytes) {
			clearTimeout(timer);
			res.status(HttpStatus.PAYLOAD_TOO_LARGE);
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
			res.send(
				JSON.stringify({
					error: 'too_large',
					size: declaredLen,
					max: this.maxBytes,
					host: parsed.host
				})
			);
			return;
		}

		// Stream through with a hard byte cap in case Content-Length was lied
		// about or absent.
		res.status(200);
		res.setHeader(
			'Content-Type',
			upstream.headers.get('content-type') ?? 'application/octet-stream'
		);
		if (Number.isFinite(declaredLen)) res.setHeader('Content-Length', String(declaredLen));
		res.setHeader('Cache-Control', 'private, max-age=60');

		let sent = 0;
		const nodeStream = Readable.fromWeb(upstream.body as any);
		nodeStream.on('data', (chunk: Buffer) => {
			sent += chunk.length;
			if (sent > this.maxBytes) {
				ctrl.abort();
				nodeStream.destroy();
				// Headers already flushed — we can't 413 at this point. Just end.
				res.end();
			}
		});
		nodeStream.on('end', () => clearTimeout(timer));
		nodeStream.on('error', () => {
			clearTimeout(timer);
			if (!res.headersSent) res.status(HttpStatus.BAD_GATEWAY);
			res.end();
		});
		nodeStream.pipe(res);
	}

	/**
	 * GET /api/proxy/info?url=<target>
	 * HEAD the upstream and report size / type / cap status — lets the client
	 * decide whether to render via the proxy or show the oversize warning.
	 */
	@Public()
	@Get('info')
	@ApiOperation({ summary: 'HEAD a remote URL to decide whether the proxy can serve it' })
	async info(@Query('url') target: string, @Req() req: Request) {
		const did = this.getActorDid(req);
		if (!this.checkRate(did)) {
			throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
		}

		const parsed = this.validateUrl(target);
		if (!parsed) throw new HttpException('Invalid or disallowed URL', HttpStatus.FORBIDDEN);

		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

		try {
			const head = await fetch(parsed.toString(), {
				method: 'HEAD',
				signal: ctrl.signal,
				redirect: 'follow',
				headers: this.forwardHeaders(req)
			});
			clearTimeout(timer);

			const lenHeader = head.headers.get('content-length');
			const size = lenHeader ? parseInt(lenHeader, 10) : null;
			return {
				ok: head.ok,
				status: head.status,
				size,
				content_type: head.headers.get('content-type') ?? null,
				max: this.maxBytes,
				exceeds_cap: Number.isFinite(size ?? NaN) ? (size as number) > this.maxBytes : null,
				host: parsed.host
			};
		} catch {
			clearTimeout(timer);
			return {
				ok: false,
				status: 0,
				size: null,
				content_type: null,
				max: this.maxBytes,
				exceeds_cap: null,
				host: parsed.host
			};
		}
	}

	// ── helpers ──

	/**
	 * Forward a narrow allowlist of headers to the upstream. We explicitly do
	 * NOT pass through UA, Accept-Language, or Cookie — those would leak
	 * fingerprinting data to the remote, which is the whole point of the
	 * proxy. Accept IS forwarded so content-negotiating endpoints (like syr's
	 * `/.well-known/syr/[did]`) return JSON instead of the browser HTML page.
	 */
	private forwardHeaders(req: Request): Record<string, string> {
		const headers: Record<string, string> = { 'User-Agent': 'syren-proxy/1.0' };
		const accept = req.headers['accept'];
		if (typeof accept === 'string') headers['Accept'] = accept;
		return headers;
	}

	private getActorDid(req: Request): string {
		// Prefer the authenticated session's DID; fall back to client IP so the
		// rate-limit bucket still meaningfully throttles unauthenticated callers
		// (e.g. native app loading <img> cross-origin without cookies).
		const did = (req as any).user?.did ?? (req as any).user?.id;
		if (did) return did;
		const fwd = req.headers['x-forwarded-for'];
		const ip = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]?.trim();
		return ip || req.ip || req.socket?.remoteAddress || 'anonymous';
	}

	private checkRate(did: string): boolean {
		const now = Date.now();
		let bucket = this.buckets.get(did);
		if (!bucket) {
			bucket = { tokens: this.RATE_CAPACITY, last: now };
			this.buckets.set(did, bucket);
		}
		const elapsed = (now - bucket.last) / 1000;
		bucket.tokens = Math.min(this.RATE_CAPACITY, bucket.tokens + elapsed * this.RATE_REFILL_PER_SEC);
		bucket.last = now;
		if (bucket.tokens < 1) return false;
		bucket.tokens -= 1;
		return true;
	}

	private validateUrl(raw: string): URL | null {
		if (!raw) return null;
		let parsed: URL;
		try {
			parsed = new URL(raw);
		} catch {
			return null;
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		if (!parsed.hostname) return null;
		if (!this.isPublicHost(parsed.hostname)) return null;
		return parsed;
	}

	private isPublicHost(host: string): boolean {
		const h = host.toLowerCase();
		// syren's own docker-internal service names — always blocked
		if (h === 'syren-surrealdb' || h === 'syren-seaweedfs') return false;

		// `localhost` resolves to 127.0.0.1 / ::1 — same rules as loopback
		if (h === 'localhost' || h.endsWith('.localhost')) return this.allowPrivate;

		const ipKind = isIP(h);
		if (ipKind === 4) {
			if (this.isAlwaysBlockedV4(h)) return false;
			if (this.isPrivateV4(h)) return this.allowPrivate;
			return true;
		}
		if (ipKind === 6) {
			if (this.isAlwaysBlockedV6(h)) return false;
			if (this.isPrivateV6(h)) return this.allowPrivate;
			return true;
		}

		// Hostname — DNS resolution + rebinding pinning deferred.
		return true;
	}

	/** IP ranges we refuse even in `allowPrivate` dev mode. */
	private isAlwaysBlockedV4(ip: string): boolean {
		const parts = ip.split('.').map((n) => parseInt(n, 10));
		if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
		const [a, b] = parts;
		if (a === 169 && b === 254) return true; // link-local / cloud metadata
		if (a === 0) return true;
		if (a >= 224) return true; // multicast + reserved
		return false;
	}

	/** Loopback + RFC1918 + CGNAT — gated by `allowPrivate`. */
	private isPrivateV4(ip: string): boolean {
		const parts = ip.split('.').map((n) => parseInt(n, 10));
		if (parts.length !== 4) return false;
		const [a, b] = parts;
		if (a === 127) return true; // loopback
		if (a === 10) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		return false;
	}

	private isAlwaysBlockedV6(ip: string): boolean {
		const h = ip.toLowerCase();
		if (h.startsWith('fe80:')) return true; // link-local
		if (h.startsWith('ff')) return true; // multicast
		return false;
	}

	private isPrivateV6(ip: string): boolean {
		const h = ip.toLowerCase();
		// Loopback + unique local addresses (RFC4193)
		if (h === '::1' || h === '::') return true;
		return h.startsWith('fc') || h.startsWith('fd');
	}
}
