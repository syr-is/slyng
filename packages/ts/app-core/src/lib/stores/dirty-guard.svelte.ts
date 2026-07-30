/**
 * createDirtyGuard — reactive unsaved-changes tracker for editors.
 *
 * Tracks a serialized snapshot of a form's values (captured at load /
 * open / save time) against their current state and exposes a reactive
 * `dirty` flag. Consumers decide what to do when `dirty` is true on a
 * close / navigation attempt — the UI (discard confirm) lives with each
 * consumer, this helper only owns the state comparison.
 *
 * Usage:
 * ```ts
 * const guard = createDirtyGuard(() => ({ name, topic }));
 * // after loading saved values into state:
 * guard.capture();
 * // on close attempt:
 * if (guard.dirty) showDiscardConfirm = true;
 * ```
 */
import { untrack } from "svelte";

/** JSON-serialize with bigint support (permission bitmasks). */
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? `${v.toString()}n` : v,
  );
}

export interface DirtyGuard {
  /** True when the current values differ from the captured snapshot. */
  readonly dirty: boolean;
  /** Capture the current values as the clean baseline (after load / save). */
  capture(): void;
  /** Drop the baseline — `dirty` stays false until the next capture. */
  clear(): void;
}

export function createDirtyGuard<T>(getCurrent: () => T): DirtyGuard {
  let saved = $state<string | null>(null);
  const dirty = $derived(saved !== null && serialize(getCurrent()) !== saved);
  return {
    get dirty() {
      return dirty;
    },
    capture() {
      // untrack: capture() is often called inside an $effect that
      // initializes the form fields — reading them tracked would make
      // that effect re-run (and reset the form) on every keystroke.
      saved = untrack(() => serialize(getCurrent()));
    },
    clear() {
      saved = null;
    },
  };
}
