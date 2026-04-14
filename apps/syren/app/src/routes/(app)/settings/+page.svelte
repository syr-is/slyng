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
		X
	} from '@lucide/svelte';
	import * as Avatar from '@syren/ui/avatar';
	import { Button } from '@syren/ui/button';
	import { Input } from '@syren/ui/input';
	import { Separator } from '@syren/ui/separator';
	import { getAuth } from '$lib/stores/auth.svelte';
	import { resolveProfile, displayName, federatedHandle } from '$lib/stores/profiles.svelte';
	import { getVoiceState } from '$lib/voice/voice-state.svelte';
	import { setMicDevice, setCameraDevice } from '$lib/voice/voice-engine';
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
	} from '$lib/stores/media-settings.svelte';
	import {
		enumerateMediaDevices,
		primeDevicePermissions,
		onDeviceChange,
		setAudioOutput,
		supportsSinkId,
		MediaUnavailableError,
		type DeviceLists
	} from '$lib/utils/media-devices';
	import {
		loadTrustedDomains,
		addTrustedDomain,
		removeTrustedDomain,
		getTrustedDomainsList
	} from '$lib/stores/trusted-domains.svelte';
	import SafeMedia from '$lib/components/safe-media.svelte';
	import SafeLink from '$lib/components/safe-link.svelte';
	import DeviceSelect from '$lib/components/settings/device-select.svelte';
	import AudioLevelMeter from '$lib/components/settings/audio-level-meter.svelte';
	import CameraPreview from '$lib/components/settings/camera-preview.svelte';

	type Tab = 'profile' | 'audio' | 'video' | 'notifications' | 'trusted';

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

	let newDomain = $state('');

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

	onDestroy(() => {
		unsubDevices();
		stopMicTest();
		stopCamPreview();
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
		camPreviewStream?.getTracks().forEach((t) => t.stop());
		camPreviewStream = null;
	}

	async function handleMicChange(id: string | undefined) {
		setMicDeviceId(id);
		if (micTestStream) await startMicTest(); // rebind to new device
		// If user is in a call, swap live
		if (voice.inVoice) {
			try { await setMicDevice(); } catch (err) { toast.error((err as Error).message); }
		}
	}

	async function handleCameraChange(id: string | undefined) {
		setCameraDeviceId(id);
		if (camPreviewStream) await startCamPreview();
		if (voice.inVoice) {
			try { await setCameraDevice(); } catch { /* not camera-on; ignored */ }
		}
	}

	async function handleSpeakerChange(id: string | undefined) {
		setSpeakerDeviceId(id);
	}

	async function testSpeakers() {
		const audio = new Audio();
		if (settings.speakerDeviceId) {
			try { await setAudioOutput(audio, settings.speakerDeviceId); } catch { /* ignore */ }
		}
		// Short 440 Hz sine, generated inline so no asset dependency
		const ctx = new AudioContext();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.frequency.value = 440;
		gain.gain.value = 0.1;
		osc.connect(gain).connect(ctx.destination);
		osc.start();
		setTimeout(() => { osc.stop(); ctx.close().catch(() => {}); }, 500);
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

	async function handleAddDomain() {
		const host = newDomain.trim().toLowerCase();
		if (!host) return;
		// Strip protocol/path if user pasted a URL
		let cleaned = host;
		try { cleaned = new URL(host.startsWith('http') ? host : `https://${host}`).host; } catch { /* keep raw */ }
		await addTrustedDomain(cleaned);
		newDomain = '';
	}

	const tabs: { id: Tab; label: string; icon: typeof User }[] = [
		{ id: 'profile', label: 'Profile', icon: User },
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
				</section>

				<Separator class="my-6" />

				<section class="mb-6 space-y-2">
					<div class="flex items-center gap-2">
						<Volume2 class="h-4 w-4 text-muted-foreground" />
						<label class="text-sm font-medium">Output device</label>
					</div>
					{#if supportsSinkId()}
						<DeviceSelect
							devices={devices.speakers}
							value={settings.speakerDeviceId}
							onSelect={handleSpeakerChange}
						/>
						<Button size="sm" variant="outline" class="mt-2" onclick={testSpeakers}>
							Test speakers
						</Button>
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
							{#if camPreviewStream}
								<Button size="sm" variant="outline" onclick={stopCamPreview}>Stop</Button>
							{:else}
								<Button size="sm" variant="outline" onclick={startCamPreview}>Start preview</Button>
							{/if}
						</div>
						<CameraPreview stream={camPreviewStream} />
					</div>
					<p class="text-xs text-muted-foreground">
						This preview is local. Turn the camera on in a voice channel to share it.
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

			{#if activeTab === 'trusted'}
				<h1 class="mb-2 text-xl font-semibold">Trusted domains</h1>
				<p class="mb-4 text-sm text-muted-foreground">
					Links to these domains skip the "Leaving syren" confirmation.
				</p>

				<form
					onsubmit={(e) => { e.preventDefault(); void handleAddDomain(); }}
					class="mb-4 flex gap-2"
				>
					<Input
						bind:value={newDomain}
						placeholder="example.com"
					/>
					<Button type="submit" disabled={!newDomain.trim()}>
						<Plus class="mr-1 h-4 w-4" /> Add
					</Button>
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
