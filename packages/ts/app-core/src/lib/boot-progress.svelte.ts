/**
 * Boot-progress signal. The (app) layout's loading fallback subscribes
 * here so the user sees what's happening during the cold-boot chain
 * instead of staring at a generic "Loading…" while the ~1.4 MB WASM
 * fetch + compile and realtime/session restore run.
 *
 * Hosts (web `+layout.ts`, native shell) call {@link setBootStage} at
 * each phase transition. The (app) layout reads {@link getBootProgress}
 * inside `{#await bootstrap}` and renders the label + an indeterminate
 * progress bar. Once `bootstrap` resolves the value is irrelevant —
 * keep the API tiny.
 */

export interface BootProgress {
	/** Short phase label. Empty string means "no stage set yet". */
	stage: string;
	/** Optional, finer-grained detail (e.g. "63%" or "syr-is.example.com"). */
	detail?: string;
}

let progress = $state<BootProgress>({ stage: '' });

export function setBootStage(stage: string, detail?: string): void {
	progress.stage = stage;
	progress.detail = detail;
}

export function getBootProgress(): BootProgress {
	return progress;
}
