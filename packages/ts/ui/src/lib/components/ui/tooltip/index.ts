import { Tooltip as TooltipPrimitive } from 'bits-ui';
import Trigger from './tooltip-trigger.svelte';
import Content from './tooltip-content.svelte';

// Explicit `typeof` annotations: without them svelte-package infers a type
// that names bits-ui's private `$$IsomorphicComponent`, which can't be named
// in the emitted .d.ts (TS4023) — so no declarations generate and every
// consumer of `@slyng/ui/tooltip` falls back to `any`.
const Root: typeof TooltipPrimitive.Root = TooltipPrimitive.Root;
const Provider: typeof TooltipPrimitive.Provider = TooltipPrimitive.Provider;
const Portal: typeof TooltipPrimitive.Portal = TooltipPrimitive.Portal;

export {
	Root,
	Trigger,
	Content,
	Provider,
	Portal,
	//
	Root as Tooltip,
	Content as TooltipContent,
	Trigger as TooltipTrigger,
	Provider as TooltipProvider,
	Portal as TooltipPortal
};
