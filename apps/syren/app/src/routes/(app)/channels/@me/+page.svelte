<script lang="ts">
	import { MessageSquare } from '@lucide/svelte';
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 p-8">
	<div class="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
		<MessageSquare class="h-8 w-8 text-muted-foreground" />
	</div>
	<p class="text-lg font-medium text-foreground">Welcome to Syren</p>
	<p class="text-sm text-muted-foreground">Select a conversation or start a new one</p>
</div>
