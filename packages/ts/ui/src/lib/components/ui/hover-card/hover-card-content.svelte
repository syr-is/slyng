<script lang="ts">
	import { LinkPreview as HoverCardPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		sideOffset = 4,
		side = 'bottom',
		align = 'center',
		children,
		...restProps
	}: HoverCardPrimitive.ContentProps = $props();
</script>

<HoverCardPrimitive.Portal>
	<HoverCardPrimitive.Content
		bind:ref
		data-slot="hover-card-content"
		{sideOffset}
		{side}
		{align}
		class={cn(
			'z-50 w-64 origin-(--bits-link-preview-content-transform-origin) rounded-md border bg-popover p-4 text-sm text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</HoverCardPrimitive.Content>
</HoverCardPrimitive.Portal>
