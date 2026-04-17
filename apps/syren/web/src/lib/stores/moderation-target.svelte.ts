/**
 * Single-slot store for the "Moderation View" sheet target.
 *
 * The sheet must survive the triggering profile hover-card closing, so the
 * sheet lives in the server layout and is driven by this store. Any profile
 * hover card can dispatch `openModeration(did, instanceUrl)` to open it.
 */

interface Target {
	did: string;
	instance_url?: string;
}

let target = $state<Target | null>(null);

export function getModerationTarget() {
	return {
		get value() {
			return target;
		},
		get open() {
			return target !== null;
		}
	};
}

export function openModeration(did: string, instanceUrl?: string) {
	target = { did, instance_url: instanceUrl };
}

export function closeModeration() {
	target = null;
}
