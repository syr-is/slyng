import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InstanceLimits } from '@slyng/types';
import { KvService } from './kv.service';

const INSTANCE_CONFIG_TYPE = 'instance_config';
const KEY_MAX_FILE_SIZE_MB = 'max_file_size_mb';
const KEY_STORAGE_LIMIT_GB = 'storage_limit_gb';

const DEFAULT_MAX_FILE_SIZE_MB = 100;
const DEFAULT_STORAGE_LIMIT_GB = 5;
const CACHE_TTL_MS = 15_000;

/**
 * Instance-level, admin-configurable upload limits. Two knobs, both stored in
 * the kv `instance_config` table (env `SLYNG_MAX_FILE_SIZE_MB` /
 * `SLYNG_STORAGE_LIMIT_GB` seed the defaults, so a fresh instance works with no
 * kv rows):
 *
 *  - **max file size** — a hard per-file cap enforced on every upload path
 *    (chat attachments, library, stories, post assets, profile images).
 *  - **storage limit** — the per-account total quota enforced on the file
 *    library.
 *
 * Values are cached in-process for a few seconds so the hot presign path
 * doesn't hit the kv table on every upload; admin writes bust the cache.
 */
@Injectable()
export class InstanceConfigService {
	private cache: { maxFileMb: number; storageGb: number; at: number } | null = null;

	constructor(
		private readonly kv: KvService,
		private readonly config: ConfigService
	) {}

	private envNum(key: string, fallback: number): number {
		const n = Number(this.config.get<string>(key, String(fallback)));
		return Number.isFinite(n) && n > 0 ? n : fallback;
	}

	private async read(): Promise<{ maxFileMb: number; storageGb: number }> {
		if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
			return { maxFileMb: this.cache.maxFileMb, storageGb: this.cache.storageGb };
		}
		const [maxFile, storage] = await Promise.all([
			this.kv.get<{ value: number }>(INSTANCE_CONFIG_TYPE, KEY_MAX_FILE_SIZE_MB),
			this.kv.get<{ value: number }>(INSTANCE_CONFIG_TYPE, KEY_STORAGE_LIMIT_GB)
		]);
		const maxFileMb =
			maxFile?.value && maxFile.value > 0
				? maxFile.value
				: this.envNum('SLYNG_MAX_FILE_SIZE_MB', DEFAULT_MAX_FILE_SIZE_MB);
		const storageGb =
			storage?.value && storage.value > 0
				? storage.value
				: this.envNum('SLYNG_STORAGE_LIMIT_GB', DEFAULT_STORAGE_LIMIT_GB);
		this.cache = { maxFileMb, storageGb, at: Date.now() };
		return { maxFileMb, storageGb };
	}

	async getMaxFileSizeBytes(): Promise<number> {
		return Math.floor((await this.read()).maxFileMb * 1024 * 1024);
	}

	async getStorageLimitBytes(): Promise<number> {
		return Math.floor((await this.read()).storageGb * 1024 * 1024 * 1024);
	}

	async getLimits(): Promise<InstanceLimits> {
		const { maxFileMb, storageGb } = await this.read();
		return {
			max_file_size_mb: maxFileMb,
			max_file_size_bytes: Math.floor(maxFileMb * 1024 * 1024),
			storage_limit_gb: storageGb,
			storage_limit_bytes: Math.floor(storageGb * 1024 * 1024 * 1024)
		};
	}

	/**
	 * Throw 413 if `size` exceeds the instance per-file cap (or an optional
	 * stricter per-type limit — e.g. stories' 50 MB). The single chokepoint every
	 * upload path calls so the admin-set cap is enforced platform-wide.
	 */
	async assertFileSize(size: number, typeMaxBytes?: number): Promise<void> {
		const cap = Math.min(await this.getMaxFileSizeBytes(), typeMaxBytes ?? Number.POSITIVE_INFINITY);
		if (size > cap) {
			const mb = Math.floor(cap / (1024 * 1024));
			throw new HttpException(`File exceeds the maximum size of ${mb} MB`, 413);
		}
	}

	async setMaxFileSizeMb(mb: number): Promise<void> {
		if (!Number.isInteger(mb) || mb <= 0) {
			throw new HttpException('Max file size must be a positive whole number of MB', 400);
		}
		await this.kv.set(INSTANCE_CONFIG_TYPE, KEY_MAX_FILE_SIZE_MB, { value: mb });
		this.cache = null;
	}

	async setStorageLimitGb(gb: number): Promise<void> {
		if (!Number.isFinite(gb) || gb <= 0) {
			throw new HttpException('Storage limit must be a positive number of GB', 400);
		}
		await this.kv.set(INSTANCE_CONFIG_TYPE, KEY_STORAGE_LIMIT_GB, { value: gb });
		this.cache = null;
	}
}
