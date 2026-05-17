/**
 * In-memory per-conversation override store.
 *
 * The persisted source of truth is the JSONL transcript's
 * `context-override-set` and `context-override-reset` events. On
 * conversation load `conversationStore.readTranscript` returns those
 * events along with the rest; the main process replays them through
 * `applyOverrideEvent` here to build the live `Map<messageId,
 * ContextMessageOverride>` state. The same state is consulted by
 * `messageWindow.partition` whenever the orchestrator (or an
 * inspector snapshot) needs to compute the effective decision for
 * each message.
 *
 * Why not just hold the events themselves: `partition` is on the
 * hot path (called per iteration) and walking the events array
 * O(events × messages) per call would be wasteful. The map is the
 * pre-reduced form.
 *
 * Why per-conversation (not per-run): overrides survive new runs in
 * the same conversation. A user who explicitly marks a sub-agent
 * verdict `'drop'` in turn 3 still wants that decision in effect
 * when they send turn 4 — the message id is content-hashed so it
 * stays stable across iterations even though the index shifts.
 */

import type { ContextMessageOverride } from '@shared/types/contextSummary.js';
import { RESET_ALL_OVERRIDES_SENTINEL } from './messageWindow.js';

/**
 * Subset of TimelineEvent fields this module consumes. Typed here
 * directly so the store doesn't import the entire `@shared/types/
 * chat` discriminated union (which would create a circular shape
 * once the IPC layer reaches back into this module).
 *
 * The persisted shape is a SINGLE `context-override-set` event
 * variant. Three semantics ride on it:
 *
 *   - `messageId !== '*'`, `override !== null` ⇒ set the named
 *     override.
 *   - `messageId !== '*'`, `override === null` ⇒ clear the named
 *     override (reset just that id).
 *   - `messageId === '*'`, `override === null` ⇒ wipe every
 *     override on the conversation in one event.
 *
 * The `(messageId === '*', override !== null)` corner is rejected
 * by the `CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE` IPC handler (review
 * finding M1). The store still treats it as a clear-all if it
 * somehow lands here (transcript hand-edit, future direct-call
 * site) — defense in depth — but the IPC layer is now the
 * authoritative rejection point.
 */
interface OverrideSetEvent {
  kind: 'context-override-set';
  messageId: string;
  override: ContextMessageOverride | null;
}
type OverrideEvent = OverrideSetEvent;

/** `conversationId → Map<messageId, override>`. */
const conversationOverrides = new Map<
  string,
  Map<string, ContextMessageOverride>
>();

/**
 * Apply a single override event to the in-memory state. Idempotent:
 * setting `'keep'` on a message that already has `'keep'` is a no-
 * op (still returns the new state). Replay-safe: walks the JSONL
 * stream during conversation load and produces the same end state
 * regardless of whether the user toggled twice through transient
 * values.
 *
 * Returns `true` when the event changed something, `false` for a
 * no-op (lets the IPC layer suppress redundant `context-snapshot-
 * changed` broadcasts).
 */
export function applyOverrideEvent(
  conversationId: string,
  event: OverrideEvent
): boolean {
  let bucket = conversationOverrides.get(conversationId);
  if (!bucket) {
    bucket = new Map();
    conversationOverrides.set(conversationId, bucket);
  }
  // Reset-all sentinel — wipe the bucket regardless of `override`.
  if (event.messageId === RESET_ALL_OVERRIDES_SENTINEL) {
    const had = bucket.size > 0;
    bucket.clear();
    // Keep the empty bucket so a future probe doesn't re-allocate
    // immediately. It'll be GC'd by `clearConversation` if the
    // conversation is removed.
    return had;
  }
  // Per-id reset — `override === null` clears the entry.
  if (event.override === null) {
    return bucket.delete(event.messageId);
  }
  // Set or replace the override.
  const prev = bucket.get(event.messageId);
  if (prev === event.override) return false;
  bucket.set(event.messageId, event.override);
  return true;
}

/**
 * Read-only view of the current overrides for a conversation.
 * Returns a frozen empty object when no overrides exist so callers
 * can index without a null check. The object identity changes only
 * when an event lands — callers can memoize against it.
 */
const EMPTY_OVERRIDES: Readonly<Record<string, ContextMessageOverride>> =
  Object.freeze({});

export function getOverrides(
  conversationId: string
): Readonly<Record<string, ContextMessageOverride>> {
  const bucket = conversationOverrides.get(conversationId);
  if (!bucket || bucket.size === 0) return EMPTY_OVERRIDES;
  // Materialize into a plain object so the renderer's structured-
  // clone bridge can ship it across IPC. Cheap — a typical
  // conversation has a handful of overrides at most.
  const out: Record<string, ContextMessageOverride> = {};
  for (const [id, override] of bucket) out[id] = override;
  return out;
}

/**
 * Bulk replay during conversation load. Called by `chat.ipc`'s
 * transcript-replay path with the full ordered list of override
 * events; the resulting `Map` matches what the user last saw
 * before closing the app.
 *
 * Wipes any in-memory state for the conversation first so a
 * reload doesn't merge with stale entries from a previous load
 * that may have been partially mutated.
 */
export function replayOverrideEvents(
  conversationId: string,
  events: ReadonlyArray<OverrideEvent>
): void {
  conversationOverrides.set(conversationId, new Map());
  for (const ev of events) applyOverrideEvent(conversationId, ev);
}

/**
 * Drop in-memory overrides for a conversation. Called when the
 * conversation is removed (tombstoned by `conversationStore`) so
 * the store doesn't accumulate dead entries across a long session.
 */
export function clearConversation(conversationId: string): void {
  conversationOverrides.delete(conversationId);
}
