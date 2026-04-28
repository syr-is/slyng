<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import {
		ArrowLeft,
		User,
		Mic,
		Video,
		Volume2,
		Bell,
		ShieldCheck,
		ExternalLink,
		Plus,
		X,
		Handshake
	} from '@lucide/svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import * as Form from '@syren/ui/form';
	import { Separator } from '@syren/ui/separator';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { z } from 'zod';
	import { getAuth } from '@syren/app-core/stores/auth.svelte';
	import { resolveProfile, displayName, federatedHandle } from '@syren/app-core/stores/profiles.svelte';
	import { getVoiceState } from '@syren/app-core/voice/voice-state.svelte';
	import { setMicDevice, setCameraDevice, setSpeakerDevice } from '@syren/app-core/voice/livekit-engine';
	import {
		getMediaSettings,
		setMicDeviceId,
		setCameraDeviceId,
		setSpeakerDeviceId,
		setEchoCancellation,
		setNoiseSuppression,
		setAutoGainControl,
		setDesktopNotifications,
		audioConstraints,
		videoConstraints
	} from '@syren/app-core/stores/media-settings.svelte';
	import {
		enumerateMediaDevices,
		primeDevicePermissions,
		onDeviceChange,
		setAudioOutput,
		supportsSinkId,
		supportsOutputDeviceSelection,
		MediaUnavailableError,
		type DeviceLists
	} from '@syren/app-core/utils/media-devices';
	import {
		isTauri,
		nativePreviewStart,
		nativePreviewStop,
		onVoiceVideoFrame,
		NATIVE_PREVIEW_PARTICIPANT
	} from '@syren/app-core/voice/native-voice-bridge';
	import {
		loadTrustedDomains,
		addTrustedDomain,
		removeTrustedDomain,
		getTrustedDomainsList
	} from '@syren/app-core/stores/trusted-domains.svelte';
	import SafeMedia from '@syren/ui/fragments/safe-media.svelte';
	import SafeLink from '@syren/ui/fragments/safe-link.svelte';
	import DeviceSelect from '@syren/ui/fragments/settings/device-select.svelte';
	import AudioLevelMeter from '@syren/ui/fragments/settings/audio-level-meter.svelte';
	import CameraPreview from '@syren/ui/fragments/settings/camera-preview.svelte';
	import RelationsPanel from '@syren/ui/fragments/settings/relations-panel.svelte';

	type Tab = 'profile' | 'audio' | 'video' | 'notifications' | 'trusted' | 'relations';

	const auth = getAuth();
	const voice = getVoiceState();
	const settings = getMediaSettings();
	const trusted = getTrustedDomainsList();

	let activeTab = $state<Tab>('profile');

	let devices = $state<DeviceLists>({ mics: [], cameras: [], speakers: [] });
	let mediaError = $state<string | null>(null);
	let permissionsPrimed = $state(false);

	// Live test streams — tied to the active tab so they release on navigation
	let micTestStream = $state<MediaStream | null>(null);
	let camPreviewStream = $state<MediaStream | null>(null);

	// `UpdateMyselfPolicyInputSchema.trusted_domains` is a `string[]`;
	// this form adds one host at a time, so the local schema models a
	// single hostname entry. The hostname rule is frontend-only — there's
	// no Rust struct for "one trusted-domain entry".
	const TrustedDomainSchema = z.object({
		host: z
			.string()
			.min(1, 'Enter a hostname')
			.regex(/^[a-z0-9.-]+(:\d+)?$/i, 'Looks malformed — use a bare hostname like example.com')
	});
	const trustedDomainForm = superForm(defaults(zod4(TrustedDomainSchema)), {
		SPA: true,
		validators: zod4Client(TrustedDomainSchema),
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			let cleaned = f.data.host.trim().toLowerCase();
			try {
				cleaned = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`).host;
			} catch {
				/* keep raw — regex above already passed */
			}
			try {
				await addTrustedDomain(cleaned);
				f.data.host = '';
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Failed to add trusted domain');
			}
		}
	});
	const { form: trustedDomainData, enhance: trustedDomainEnhance, submitting: trustedDomainSubmitting } =
		trustedDomainForm;

	const profile = $derived(resolveProfile(auth.identity?.did ?? '', auth.identity?.syr_instance_url));
	const profileName = $derived(displayName(profile, auth.identity?.did ?? ''));
	const profileHandle = $derived(federatedHandle(profile, auth.identity?.did ?? ''));

	onMount(async () => {
		await loadTrustedDomains();
		try {
			await primeDevicePermissions();
			permissionsPrimed = true;
		} catch (err) {
			if (err instanceof MediaUnavailableError) mediaError = err.message;
		}
		await refreshDevices();
	});

	async function refreshDevices() {
		try {
			devices = await enumerateMediaDevices();
		} catch (err) {
			mediaError = err instanceof Error ? err.message : 'Could not enumerate devices';
		}
	}

	const unsubDevices = onDeviceChange(() => { void refreshDevices(); });

	// AudioContexts and the speaker-test timeout that the Test Speakers
	// button creates are tracked here so onDestroy can clean them up if
	// the user navigates away mid-test. Browsers cap live AudioContexts
	// (~6 in Chrome) and rapid Test clicks during navigation could hit
	// that ceiling without this.
	let activeSpeakerCtx: AudioContext | null = null;
	let speakerTimeout: ReturnType<typeof setTimeout> | null = null;

	onDestroy(() => {
		unsubDevices();
		unsubNativePreview();
		stopMicTest();
		stopCamPreview();
		if (speakerTimeout) {
			clearTimeout(speakerTimeout);
			speakerTimeout = null;
		}
		if (activeSpeakerCtx) {
			activeSpeakerCtx.close().catch(() => {});
			activeSpeakerCtx = null;
		}
	});

	$effect(() => {
		// Release test streams when leaving the tab they belong to
		if (activeTab !== 'audio') stopMicTest();
		if (activeTab !== 'video') stopCamPreview();
	});

	async function startMicTest() {
		stopMicTest();
		try {
			micTestStream = await navigator.mediaDevices.getUserMedia({
				audio: audioConstraints(),
				video: false
			});
		} catch (err) {
			toast.error((err as Error).message || 'Could not open microphone');
		}
	}

	function stopMicTest() {
		micTestStream?.getTracks().forEach((t) => t.stop());
		micTestStream = null;
	}

	async function startCamPreview() {
		stopCamPreview();
		if (isTauri()) {
			try {
				await nativePreviewStart(settings.cameraDeviceId ?? null);
				nativePreviewActive = true;
			} catch (err) {
				toast.error((err as Error).message || 'Could not open camera');
			}
			return;
		}
		try {
			camPreviewStream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: videoConstraints()
			});
		} catch (err) {
			toast.error((err as Error).message || 'Could not open camera');
		}
	}

	function stopCamPreview() {
		if (isTauri()) {
			if (nativePreviewActive) {
				void nativePreviewStop().catch(() => {});
				nativePreviewActive = false;
			}
			if (nativePreviewCanvas) {
				const ctx = nativePreviewCanvas.getContext('2d');
				ctx?.clearRect(0, 0, nativePreviewCanvas.width, nativePreviewCanvas.height);
			}
			return;
		}
		camPreviewStream?.getTracks().forEach((t) => t.stop());
		camPreviewStream = null;
	}

	let nativePreviewActive = $state(false);
	let nativePreviewCanvas = $state<HTMLCanvasElement | null>(null);
	const unsubNativePreview = isTauri()
		? onVoiceVideoFrame((f) => {
			if (f.participant !== NATIVE_PREVIEW_PARTICIPANT) return;
			if (!nativePreviewCanvas) return;
			if (nativePreviewCanvas.width !== f.width) nativePreviewCanvas.width = f.width;
			if (nativePreviewCanvas.height !== f.height) nativePreviewCanvas.height = f.height;
			const ctx = nativePreviewCanvas.getContext('2d');
			if (!ctx) return;
			const img = new Image();
			img.onload = () => ctx.drawImage(img, 0, 0, f.width, f.height);
			img.src = `data:image/jpeg;base64,${f.jpeg_b64}`;
		})
		: () => {};

	async function handleMicChange(id: string | undefined) {
		setMicDeviceId(id);
		if (micTestStream) await startMicTest(); // rebind to new device
		// On native, push the choice to Rust unconditionally so the
		// preference is stashed for the next join even outside a call.
		if (isTauri() || voice.inVoice) {
			try { await setMicDevice(); } catch (err) { toast.error((err as Error).message); }
		}
	}

	async function handleCameraChange(id: string | undefined) {
		setCameraDeviceId(id);
		// Restart whichever preview is currently active so it
		// re-opens against the newly selected camera.
		if (camPreviewStream || nativePreviewActive) await startCamPreview();
		if (isTauri() || voice.inVoice) {
			try { await setCameraDevice(); } catch { /* not camera-on; ignored */ }
		}
	}

	async function handleSpeakerChange(id: string | undefined) {
		setSpeakerDeviceId(id);
		if (isTauri()) {
			try { await setSpeakerDevice(id ?? null); } catch (err) { toast.error((err as Error).message); }
		}
	}

	async function testSpeakers() {
		const audio = new Audio();
		if (settings.speakerDeviceId) {
			try { await setAudioOutput(audio, settings.speakerDeviceId); } catch { /* ignore */ }
		}
		// Short 440 Hz sine, generated inline so no asset dependency.
		// Stash ctx + timeout in module-level refs so onDestroy can
		// reclaim them if the user leaves the page within 500 ms.
		if (activeSpeakerCtx) activeSpeakerCtx.close().catch(() => {});
		if (speakerTimeout) clearTimeout(speakerTimeout);
		const ctx = new AudioContext();
		activeSpeakerCtx = ctx;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.frequency.value = 440;
		gain.gain.value = 0.1;
		osc.connect(gain).connect(ctx.destination);
		osc.start();
		speakerTimeout = setTimeout(() => {
			osc.stop();
			ctx.close().catch(() => {});
			if (activeSpeakerCtx === ctx) activeSpeakerCtx = null;
			speakerTimeout = null;
		}, 500);
	}

	async function requestNotificationPermission() {
		if (!('Notification' in window)) {
			toast.error('Notifications not supported by this browser');
			return;
		}
		const permission = await Notification.requestPermission();
		setDesktopNotifications(permission === 'granted');
		if (permission === 'denied') toast.error('Permission denied. Enable in browser settings.');
	}

	const tabs: { id: Tab; label: string; icon: typeof User }[] = [
		{ id: 'profile', label: 'Profile', icon: User },
		{ id: 'relations', label: 'Relations', icon: Handshake },
		{ id: 'audio', label: 'Audio', icon: Mic },
		{ id: 'video', label: 'Video', icon: Video },
		{ id: 'notifications', label: 'Notifications', icon: Bell },
		{ id: 'trusted', label: 'Trusted domains', icon: ShieldCheck }
	];
</script>

<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
	<!-- Left nav -->
	<aside class="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
		<div class="flex h-12 items-center gap-2 border-b border-sidebar-border px-3">
			<Button variant="ghost" size="icon" onclick={() => goto('/channels/@me')} title="Back">
				<ArrowLeft class="h-4 w-4" />
			</Button>
			<span class="text-sm font-semibold">Settings</span>
		</div>
		<nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
			{#each tabs as tab (tab.id)}
				{@const Icon = tab.icon}
				<button
					onclick={() => (activeTab = tab.id)}
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors
						{activeTab === tab.id
						? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
						: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}"
				>
					<Icon class="h-4 w-4 shrink-0" />
					<span>{tab.label}</span>
				</button>
			{/each}
		</nav>
	</aside>

	<!-- Content -->
	<main class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-2xl p-6 pb-24">
			{#if mediaError && activeTab !== 'profile' && activeTab !== 'trusted'}
				<div class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
					{mediaError}
				</div>
			{/if}

			{#if activeTab === 'profile'}
				<h1 class="mb-4 text-xl font-semibold">Profile</h1>
				<p class="mb-4 text-sm text-muted-foreground">
					Your profile lives on your syr instance. Syren only shows it.
				</p>

				<div class="overflow-hidden rounded-lg border border-border bg-card">
					{#if profile.banner_url}
						<div class="relative h-32 w-full bg-muted">
							<SafeMedia src={profile.banner_url} as="img" class="h-full w-full object-cover" />
						</div>
					{/if}
					<div class="flex items-start gap-4 p-4 {profile.banner_url ? '-mt-10' : ''}">
						<Avatar.Root class="h-20 w-20 border-4 border-card shadow-md">
							{#if profile.avatar_url}
								<Avatar.Image src={profile.avatar_url} alt={profileName} />
							{/if}
							<Avatar.Fallback class="text-lg">
								{profileName.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="min-w-0 flex-1 pt-4">
							<h2 class="truncate text-lg font-semibold">{profileName}</h2>
							<p class="truncate font-mono text-xs text-muted-foreground">{profileHandle}</p>
						</div>
					</div>
					{#if profile.bio}
						<div class="border-t border-border px-4 py-3">
							<p class="whitespace-pre-wrap text-sm text-foreground/90">{profile.bio}</p>
						</div>
					{/if}
				</div>

				<div class="mt-4 space-y-2 rounded-lg border border-border bg-card p-4">
					<div class="flex items-center justify-between text-xs">
						<span class="text-muted-foreground">DID</span>
						<span class="truncate font-mono">{auth.identity?.did ?? '—'}</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-muted-foreground">Instance</span>
						<span class="truncate font-mono">{auth.identity?.syr_instance_url ?? '—'}</span>
					</div>
				</div>

				{#if auth.identity?.syr_instance_url}
					<div class="mt-4">
						<SafeLink href={auth.identity.syr_instance_url} class="inline-flex">
							<Button variant="outline">
								<ExternalLink class="mr-1.5 h-4 w-4" />
								Edit on syr
							</Button>
						</SafeLink>
					</div>
				{/if}
			{/if}

			{#if activeTab === 'audio'}
				<h1 class="mb-4 text-xl font-semibold">Audio</h1>

				<section class="mb-6 space-y-2">
					<div class="flex items-center gap-2">
						<Mic class="h-4 w-4 text-muted-foreground" />
						<label class="text-sm font-medium">Input device</label>
					</div>
					<DeviceSelect
						devices={devices.mics}
						value={settings.micDeviceId}
						onSelect={handleMicChange}
					/>
					{#if !isTauri()}
						<div class="mt-3 space-y-2">
							<div class="flex items-center justify-between">
								<span class="text-xs text-muted-foreground">Input level</span>
								{#if micTestStream}
									<Button size="sm" variant="outline" onclick={stopMicTest}>Stop</Button>
								{:else}
									<Button size="sm" variant="outline" onclick={startMicTest}>Test microphone</Button>
								{/if}
							</div>
							<AudioLevelMeter stream={micTestStream} />
						</div>
					{/if}
				</section>

				<Separator class="my-6" />

				<section class="mb-6 space-y-2">
					<div class="flex items-center gap-2">
						<Volume2 class="h-4 w-4 text-muted-foreground" />
						<label class="text-sm font-medium">Output device</label>
					</div>
					{#if supportsOutputDeviceSelection()}
						<DeviceSelect
							devices={devices.speakers}
							value={settings.speakerDeviceId}
							onSelect={handleSpeakerChange}
						/>
						{#if supportsSinkId()}
							<Button size="sm" variant="outline" class="mt-2" onclick={testSpeakers}>
								Test speakers
							</Button>
						{/if}
					{:else}
						<p class="text-xs text-muted-foreground">
							Output device selection is not supported in this browser. Your system default is used.
						</p>
					{/if}
				</section>

				<Separator class="my-6" />

				<section class="space-y-2">
					<h2 class="text-sm font-medium">Input processing</h2>
					<p class="text-xs text-muted-foreground">Takes effect next time you join voice.</p>
					<label class="flex items-center justify-between py-1">
						<span class="text-sm">Echo cancellation</span>
						<input
							type="checkbox"
							checked={settings.echoCancellation}
							onchange={(e) => setEchoCancellation((e.currentTarget as HTMLInputElement).checked)}
							class="h-4 w-4 cursor-pointer accent-primary"
						/>
					</label>
					<label class="flex items-center justify-between py-1">
						<span class="text-sm">Noise suppression</span>
						<input
							type="checkbox"
							checked={settings.noiseSuppression}
							onchange={(e) => setNoiseSuppression((e.currentTarget as HTMLInputElement).checked)}
							class="h-4 w-4 cursor-pointer accent-primary"
						/>
					</label>
					<label class="flex items-center justify-between py-1">
						<span class="text-sm">Automatic gain control</span>
						<input
							type="checkbox"
							checked={settings.autoGainControl}
							onchange={(e) => setAutoGainControl((e.currentTarget as HTMLInputElement).checked)}
							class="h-4 w-4 cursor-pointer accent-primary"
						/>
					</label>
				</section>
			{/if}

			{#if activeTab === 'video'}
				<h1 class="mb-4 text-xl font-semibold">Video</h1>

				{#if isTauri()}
					<div class="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
						Screen sharing isn't wired through the native pipeline yet — use the web client to
						share a screen. Camera capture works.
					</div>
				{/if}

				<section class="space-y-3">
					<div class="flex items-center gap-2">
						<Video class="h-4 w-4 text-muted-foreground" />
						<label class="text-sm font-medium">Camera</label>
					</div>
					<DeviceSelect
						devices={devices.cameras}
						value={settings.cameraDeviceId}
						onSelect={handleCameraChange}
					/>

					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Preview</span>
							{#if isTauri() ? nativePreviewActive : camPreviewStream}
								<Button size="sm" variant="outline" onclick={stopCamPreview}>Stop</Button>
							{:else}
								<Button size="sm" variant="outline" onclick={startCamPreview}>Start preview</Button>
							{/if}
						</div>
						{#if isTauri()}
							<div class="aspect-video w-full overflow-hidden rounded-md border border-border bg-muted/40">
								<canvas
									bind:this={nativePreviewCanvas}
									class="h-full w-full object-contain"
								></canvas>
							</div>
						{:else}
							<CameraPreview stream={camPreviewStream} />
						{/if}
					</div>
					<p class="text-xs text-muted-foreground">
						This preview is local. Turn the camera on in a voice channel to share it.
						{#if isTauri()}Stop the preview before joining voice — the camera can only be opened in one place at a time.{/if}
					</p>
				</section>
			{/if}

			{#if activeTab === 'notifications'}
				<h1 class="mb-4 text-xl font-semibold">Notifications</h1>

				<label class="flex items-center justify-between rounded-lg border border-border bg-card p-4">
					<div>
						<p class="text-sm font-medium">Desktop notifications</p>
						<p class="text-xs text-muted-foreground">
							Get notified about mentions and DMs even when syren is backgrounded.
						</p>
					</div>
					<input
						type="checkbox"
						checked={settings.desktopNotifications}
						onchange={async (e) => {
							const checked = (e.currentTarget as HTMLInputElement).checked;
							if (checked) await requestNotificationPermission();
							else setDesktopNotifications(false);
						}}
						class="h-4 w-4 shrink-0 cursor-pointer accent-primary"
					/>
				</label>
			{/if}

			{#if activeTab === 'relations'}
				<h1 class="mb-4 text-xl font-semibold">Relations</h1>
				<RelationsPanel />
			{/if}

			{#if activeTab === 'trusted'}
				<h1 class="mb-2 text-xl font-semibold">Trusted domains</h1>
				<p class="mb-4 text-sm text-muted-foreground">
					Links to these domains skip the "Leaving syren" confirmation.
				</p>

				<form method="POST" use:trustedDomainEnhance class="mb-4">
					<Form.Field form={trustedDomainForm} name="host">
						<div class="flex gap-2">
							<Form.Control>
								{#snippet children({ props })}
									<Input
										{...props}
										bind:value={$trustedDomainData.host}
										placeholder="example.com"
										class="flex-1"
									/>
								{/snippet}
							</Form.Control>
							<Form.Button disabled={$trustedDomainSubmitting}>
								<Plus class="mr-1 h-4 w-4" /> Add
							</Form.Button>
						</div>
						<Form.FieldErrors />
					</Form.Field>
				</form>

				<div class="space-y-1">
					{#each trusted.list as host (host)}
						<div class="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
							<span class="truncate font-mono text-sm">{host}</span>
							<Button
								variant="ghost"
								size="icon"
								onclick={() => removeTrustedDomain(host)}
								title="Remove"
							>
								<X class="h-4 w-4" />
							</Button>
						</div>
					{/each}
					{#if trusted.list.length === 0}
						<p class="py-4 text-center text-sm text-muted-foreground">
							No trusted domains yet.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</main>
</div>
