// `@`-triggered mention autocomplete for the chat composer. Mirrors the emoji
// `:`-suggestion: the @tiptap/suggestion render() hooks drive a small reactive
// $state controller that <MentionSuggestionPopup> reads. Candidates come from
// the active server's member store (+ `@everyone` when the caller holds
// MENTION_EVERYONE). Selecting one inserts a MentionNode serializing to
// `<@did>`; the backend re-validates on send, so the popup is advisory only.
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { Permissions } from '@slyng/types';
import { getAuth } from '@slyng/app-core/stores/auth.svelte';
import { getMembers } from '@slyng/app-core/stores/members.svelte';
import { getPerms } from '@slyng/app-core/stores/perms.svelte';
import { resolveProfile, displayName } from '@slyng/app-core/stores/profiles.svelte';
import { proxied } from '@slyng/app-core/utils/proxy';

export interface MentionCandidate {
	/** `'everyone'` or a member DID. */
	did: string;
	label: string;
	avatarUrl?: string;
	everyone?: boolean;
}

/** Rank server members (+ optional @everyone) by name/DID against the query. */
function searchMentions(query: string, limit: number): MentionCandidate[] {
	const myDid = getAuth().identity?.did;
	const q = query.toLowerCase();
	const out: MentionCandidate[] = [];

	if (getPerms().can(Permissions.MENTION_EVERYONE) && (!q || 'everyone'.startsWith(q))) {
		out.push({ did: 'everyone', label: 'everyone', everyone: true });
	}

	const scored: { c: MentionCandidate; starts: boolean }[] = [];
	for (const m of getMembers().list) {
		if (m.user_id === myDid) continue; // no self-mention
		const profile = resolveProfile(m.user_id, m.syr_instance_url);
		const name = ((m as { nickname?: string }).nickname || displayName(profile, m.user_id)) as string;
		const nl = name.toLowerCase();
		if (q && !nl.includes(q) && !m.user_id.toLowerCase().includes(q)) continue;
		scored.push({
			c: {
				did: m.user_id,
				label: name,
				avatarUrl: profile.avatar_url ? proxied(profile.avatar_url) : undefined
			},
			starts: nl.startsWith(q)
		});
	}
	scored.sort((a, b) => (a.starts === b.starts ? 0 : a.starts ? -1 : 1));
	for (const s of scored) {
		out.push(s.c);
		if (out.length >= limit) break;
	}
	return out.slice(0, limit);
}

class MentionSuggestionController {
	open = $state(false);
	items = $state<MentionCandidate[]>([]);
	index = $state(0);
	rect = $state<DOMRect | null>(null);
	#command: ((c: MentionCandidate) => void) | null = null;

	start(items: MentionCandidate[], command: (c: MentionCandidate) => void, rect: DOMRect | null): void {
		this.items = items;
		this.index = 0;
		this.rect = rect;
		this.#command = command;
		this.open = true;
	}

	update(items: MentionCandidate[], command: (c: MentionCandidate) => void, rect: DOMRect | null): void {
		this.items = items;
		this.index = Math.min(this.index, Math.max(0, items.length - 1));
		this.rect = rect;
		// Adopt the fresh closure each keystroke (its range covers the live query).
		this.#command = command;
	}

	close(): void {
		this.open = false;
		this.items = [];
		this.rect = null;
		this.#command = null;
	}

	pick(c: MentionCandidate): void {
		this.#command?.(c);
	}

	/** Returns true if the key was consumed by the popup. */
	onKeyDown(event: KeyboardEvent): boolean {
		if (!this.open || this.items.length === 0) return false;
		switch (event.key) {
			case 'ArrowDown':
				this.index = (this.index + 1) % this.items.length;
				return true;
			case 'ArrowUp':
				this.index = (this.index - 1 + this.items.length) % this.items.length;
				return true;
			case 'Enter':
			case 'Tab':
				this.pick(this.items[this.index]);
				return true;
			case 'Escape':
				this.close();
				return true;
			default:
				return false;
		}
	}
}

export const mentionSuggestion = new MentionSuggestionController();

/** Distinct from the emoji suggestion's key — see the note there. */
const mentionSuggestionKey = new PluginKey('mentionSuggestion');

export function MentionSuggestion() {
	return Extension.create({
		name: 'mentionSuggestion',
		addProseMirrorPlugins() {
			return [
				Suggestion<MentionCandidate>({
					editor: this.editor,
					pluginKey: mentionSuggestionKey,
					char: '@',
					allowSpaces: false,
					startOfLine: false,
					items: ({ query }) => searchMentions(query, 8),
					command: ({ editor, props }) => {
						// Recompute the replace span from the LIVE doc rather than trust the
						// passed range (a stale closure). Find the trailing `@query` at the
						// caret and replace exactly that with the mention node + a space.
						const { selection } = editor.state;
						const to = selection.$from.pos;
						const before = selection.$from.parent.textBetween(
							Math.max(0, selection.$from.parentOffset - 100),
							selection.$from.parentOffset,
							'\n',
							'￼'
						);
						const m = before.match(/@[^\s@]*$/);
						const from = m ? to - m[0].length : to;
						editor
							.chain()
							.focus()
							.insertContentAt({ from, to }, [
								{ type: 'mention', attrs: { did: props.did, label: props.label } },
								{ type: 'text', text: ' ' }
							])
							.run();
					},
					render: () => ({
						onStart: (p) => {
							mentionSuggestion.start(p.items, (c) => p.command(c), p.clientRect?.() ?? null);
						},
						onUpdate: (p) => {
							mentionSuggestion.update(p.items, (c) => p.command(c), p.clientRect?.() ?? null);
						},
						onKeyDown: (p) => mentionSuggestion.onKeyDown(p.event),
						onExit: () => {
							mentionSuggestion.close();
						}
					})
				})
			];
		}
	});
}
