/**
 * Inline Markdown → sanitized HTML for chat message bodies. Mirrors pendi's
 * read-side prose pipeline: `marked.parseInline` (bold / italic / code /
 * strikethrough / links) + DOMPurify. Only INLINE constructs are supported —
 * chat bubbles don't host headings / lists / code-fences — which also keeps the
 * composer (block nodes disabled) and the renderer in agreement.
 *
 * Emoji/sticker shortcodes are tokenized out BEFORE this runs (see
 * `@slyng/app-core/utils/emoji-render`), so only prose runs reach here; bare
 * URLs stay as `link` tokens (rendered via `<SafeLink>`) so rule 7's outbound
 * consent still applies. Explicit `[label](url)` markdown becomes a plain
 * `<a target="_blank" rel="noopener noreferrer">`.
 *
 * Browser-only: DOMPurify needs a DOM. On the server (SSR type-check paths) it
 * returns escaped text so no unsanitized markup can ever ship.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['strong', 'em', 'b', 'i', 'code', 'a', 'del', 's', 'br', 'span'];
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel'];

let hookInstalled = false;
function ensureHook(): void {
	if (hookInstalled || typeof window === 'undefined') return;
	// Force any surviving anchor to open safely — no window.opener handle, no
	// Referer header leak to the destination.
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if ((node as Element).tagName === 'A' && (node as Element).getAttribute('href')) {
			(node as Element).setAttribute('target', '_blank');
			(node as Element).setAttribute('rel', 'noopener noreferrer');
		}
	});
	hookInstalled = true;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render one prose run of a message as sanitized inline-markdown HTML. */
export function renderInlineMarkdown(text: string): string {
	if (!text) return '';
	if (typeof window === 'undefined') return escapeHtml(text);
	ensureHook();
	// Preserve leading/trailing whitespace that marked would trim, so spacing
	// around adjacent emoji tokens stays intact (the container is pre-wrap).
	const lead = text.match(/^\s*/)?.[0] ?? '';
	const trail = text.match(/\s*$/)?.[0] ?? '';
	const core = text.slice(lead.length, text.length - trail.length);
	if (!core) return text; // whitespace-only run — nothing to format
	const raw = marked.parseInline(core, { async: false, gfm: true, breaks: false }) as string;
	const clean = DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR });
	return lead + clean + trail;
}
