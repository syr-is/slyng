<script lang="ts">
	import { Progress as ProgressPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		max = 100,
		value,
		...restProps
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();

	// Guard the indicator math: a caller-supplied `max` of 0 (or anything
	// non-positive) would otherwise produce Infinity/NaN in the transform
	// and blank out the bar. Clamp `max` to at least 1 and `value` into
	// `[0, safeMax]` before computing the percentage.
	const safeMax = $derived(Math.max(1, max ?? 1));
	const safeValue = $derived(Math.min(Math.max(value ?? 0, 0), safeMax));
</script>

<ProgressPrimitive.Root
	bind:ref
	data-slot="progress"
	class={cn("bg-muted h-1 rounded-full relative flex w-full items-center overflow-x-hidden", className)}
	{value}
	{max}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		class="bg-primary size-full flex-1 transition-all"
		style="transform: translateX(-{100 - (100 * safeValue) / safeMax}%)"
	></div>
</ProgressPrimitive.Root>
