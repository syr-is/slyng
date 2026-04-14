<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';
	import {
		proxied,
		fetchProxyInfo,
		originHost,
		formatBytes,
		type ProxyInfo
	} from '$lib/utils/proxy';

	const {
		src,
		alt = '',
		as = 'img',
		class: className = '',
		videoControls = false,
		videoAutoplay = false,
		videoMuted = true,
		videoLoop = false,
		videoPlaysinline = true,
		onclick
	}: {
		src: string | null | undefined;
		alt?: string;
		as?: 'img' | 'video';
		class?: string;
		videoControls?: boolean;
		videoAutoplay?: boolean;
		videoMuted?: boolean;
		videoLoop?: boolean;
		videoPlaysinline?: boolean;
		onclick?: (e: MouseEvent) => void;
	} = $props();

	type State =
		| { kind: 'proxy' }
		| { kind: 'checking' }
		| { kind: 'direct'; accepted: true }
		| { kind: 'oversize'; info: ProxyInfo }
		| { kind: 'failed' };

	let state = $state<State>({ kind: 'proxy' });

	// Reset on src change
	let prevSrc: string | undefined;
	$effect(() => {
		if (src !== prevSrc) {
			prevSrc = src ?? undefined;
			state = { kind: 'proxy' };
		}
	});

	const proxiedSrc = $derived(src ? proxied(src) : '');
	const isRemote = $derived(!!src && proxiedSrc.startsWith('/api/proxy'));

	async function handleLoadError() {
		if (!src || !isRemote || state.kind !== 'proxy') return;
		state = { kind: 'checking' };
		const info = await fetchProxyInfo(src);
		if (info && info.exceeds_cap === true) {
			state = { kind: 'oversize', info };
		} else {
			state = { kind: 'failed' };
		}
	}

	function loadDirectly() {
		state = { kind: 'direct', accepted: true };
	}

	const renderSrc = $derived(
		state.kind === 'direct' ? (src ?? '') : proxiedSrc
	);
</script>

{#if state.kind === 'oversize'}
	<div
		class="flex max-w-md flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs {className}"
	>
		<div class="flex items-start gap-2">
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
			<div class="min-w-0 flex-1">
				<p class="font-medium text-foreground">File too large for syren proxy</p>
				<p class="mt-1 text-muted-foreground">
					This file is
					<span class="font-medium text-foreground">
						{state.info.size != null ? formatBytes(state.info.size) : 'larger than the cap'}
					</span>
					— syren only proxies up to
					<span class="font-medium text-foreground">{formatBytes(state.info.max)}</span>.
				</p>
				<p class="mt-1 text-muted-foreground">
					You can load it directly from
					<span class="font-mono text-foreground">{state.info.host}</span>
					— doing so will reveal your IP address to that server.
				</p>
			</div>
		</div>
		<div class="flex gap-2">
			<button
				type="button"
				onclick={loadDirectly}
				class="rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600"
			>
				Load directly
			</button>
			<button
				type="button"
				onclick={() => (state = { kind: 'failed' })}
				class="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
			>
				Cancel
			</button>
		</div>
	</div>
{:else if state.kind === 'failed'}
	<div
		class="flex max-w-md items-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground {className}"
	>
		<AlertTriangle class="h-4 w-4 shrink-0" />
		<span class="truncate">Couldn't load from {originHost(src)}</span>
	</div>
{:else if as === 'video'}
	<video
		src={renderSrc}
		class={className}
		controls={videoControls}
		autoplay={videoAutoplay}
		muted={videoMuted}
		loop={videoLoop}
		playsinline={videoPlaysinline}
		preload="metadata"
		onerror={handleLoadError}
		{onclick}
	>
		<track kind="captions" label="Captions unavailable" />
	</video>
{:else}
	<img
		src={renderSrc}
		{alt}
		class={className}
		onerror={handleLoadError}
		{onclick}
		draggable={false}
	/>
{/if}
