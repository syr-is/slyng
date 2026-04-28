<script lang="ts">
	import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, Monitor, MonitorOff, Video, VideoOff } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { getVoiceState, setSelfMute, setSelfDeaf } from '@syren/app-core/voice/voice-state.svelte';
	import {
		toggleMute,
		toggleDeafen,
		leaveVoiceChannel,
		startScreenShare,
		stopScreenShare,
		isScreenSharing,
		isScreenShareSupported,
		startCamera,
		stopCamera,
		isCameraOn,
		ScreenSharePermissionError,
		CameraPermissionError
	} from '@syren/app-core/voice/livekit-engine';

	const voice = getVoiceState();

	let sharing = $state(false);
	let cameraOn = $state(false);

	function handleMute() {
		const muted = toggleMute();
		setSelfMute(muted);
		// Deafen implies mute — if we unmute while deafened, lift deafen too
		if (!muted && voice.selfDeaf) setSelfDeaf(false);
	}

	function handleDeafen() {
		const deaf = toggleDeafen();
		setSelfDeaf(deaf);
		setSelfMute(deaf); // deafen forces mute
	}

	async function handleScreenShare() {
		if (sharing) {
			await stopScreenShare();
			sharing = false;
			return;
		}
		try {
			await startScreenShare();
			sharing = isScreenSharing();
			cameraOn = isCameraOn();
		} catch (err) {
			if (err instanceof ScreenSharePermissionError) {
				if (err.reason === 'denied') toast.info('Screen share cancelled');
				else toast.error(err.message);
			} else {
				toast.error('Screen share failed');
			}
		}
	}

	async function handleCamera() {
		if (cameraOn) {
			await stopCamera();
			cameraOn = false;
			return;
		}
		try {
			await startCamera();
			cameraOn = isCameraOn();
			sharing = isScreenSharing();
		} catch (err) {
			if (err instanceof CameraPermissionError) {
				if (err.reason === 'denied') toast.error('Camera access denied');
				else if (err.reason === 'no_device') toast.error('No camera found');
				else toast.error(err.message);
			} else {
				toast.error('Could not start camera');
			}
		}
	}

	async function handleDisconnect() {
		sharing = false;
		cameraOn = false;
		await leaveVoiceChannel();
	}
</script>

{#if voice.inVoice}
	<div class="border-t border-sidebar-border bg-sidebar p-2">
		<div class="mb-2 flex items-center gap-2 px-1">
			<div class="h-2 w-2 rounded-full bg-green-500"></div>
			<span class="text-xs font-medium text-green-500">Voice Connected</span>
		</div>

		<div class="flex items-center justify-center gap-1">
			<button
				onclick={handleMute}
				class="rounded-full p-2 transition-colors
					{voice.selfMute ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
				title={voice.selfMute ? 'Unmute' : 'Mute'}
			>
				{#if voice.selfMute}
					<MicOff class="h-4 w-4" />
				{:else}
					<Mic class="h-4 w-4" />
				{/if}
			</button>

			<button
				onclick={handleDeafen}
				class="rounded-full p-2 transition-colors
					{voice.selfDeaf ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
				title={voice.selfDeaf ? 'Undeafen' : 'Deafen'}
			>
				{#if voice.selfDeaf}
					<HeadphoneOff class="h-4 w-4" />
				{:else}
					<Headphones class="h-4 w-4" />
				{/if}
			</button>

			<button
				onclick={handleCamera}
				class="rounded-full p-2 transition-colors
					{cameraOn ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
				title={cameraOn ? 'Stop camera' : 'Turn on camera'}
			>
				{#if cameraOn}
					<Video class="h-4 w-4" />
				{:else}
					<VideoOff class="h-4 w-4" />
				{/if}
			</button>

			{#if isScreenShareSupported()}
				<button
					onclick={handleScreenShare}
					class="rounded-full p-2 transition-colors
						{sharing ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
					title={sharing ? 'Stop sharing' : 'Share screen'}
				>
					{#if sharing}
						<Monitor class="h-4 w-4" />
					{:else}
						<MonitorOff class="h-4 w-4" />
					{/if}
				</button>
			{/if}

			<button
				onclick={handleDisconnect}
				class="rounded-full p-2 text-destructive transition-colors hover:bg-destructive/20"
				title="Disconnect"
			>
				<PhoneOff class="h-4 w-4" />
			</button>
		</div>
	</div>
{/if}
