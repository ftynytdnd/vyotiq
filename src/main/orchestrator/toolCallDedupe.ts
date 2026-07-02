/**
 * Per-run guard against identical tool+args spam.
 *
 * Spin-prone tools (`read`, `search`, `ls`) block on the second identical
 * dispatch so the model cannot loop through a third repeat. Successful
 * `bash` repeats are handled by the result cache (soft replay) instead.
 * Other tools allow two attempts then block.
 *
 * Excluded tools self-govern repeats and must never see the hostile generic
 * block: `finish` / `ask_user` are legitimately repeatable terminals, and
 * `context` is an idempotent, self-deduping reference loader (it returns its
 * own graceful `[already loaded]` / `[already listed]` banner on repeats — see
 * `context.tool.ts`). Letting the generic blocker fire on `context` produced a
 * confusing `BLOCKED: identical arguments` message that derailed weaker models.
 * `todos` merge/replace is idempotent by design (`todos.tool.ts`) — blocking
 * identical status updates produced the same spin without helping the model.
 */

import type { ToolResult } from '@shared/types/tool.js';
import type { ToolName } from '@shared/types/tool.js';
import { toolCallSignature } from './loop/toolSpinSignature.js';

const MAX_IDENTICAL_DISPATCHES_DEFAULT = 3;
const MAX_IDENTICAL_DISPATCHES_SPIN_PRONE = 2;

const EXCLUDED_TOOLS = new Set<string>(['finish', 'ask_user', 'context', 'todos', 'continue', 'heartbeat']);

const SPIN_PRONE_TOOLS = new Set<string>(['read', 'search', 'ls', 'sg']);

export function isSpinProneTool(toolName: string): boolean {
  return SPIN_PRONE_TOOLS.has(toolName);
}

function maxIdenticalDispatches(toolName: string): number {
  return isSpinProneTool(toolName)
    ? MAX_IDENTICAL_DISPATCHES_SPIN_PRONE
    : MAX_IDENTICAL_DISPATCHES_DEFAULT;
}

interface DedupeEntry {
  count: number;
}

const dedupeBySignal = new WeakMap<AbortSignal, Map<string, DedupeEntry>>();

function dedupeMap(signal: AbortSignal): Map<string, DedupeEntry> {
  let map = dedupeBySignal.get(signal);
  if (!map) {
    map = new Map();
    dedupeBySignal.set(signal, map);
  }
  return map;
}

/**
 * Returns a blocked `ToolResult` when the same tool+args exceeded the
 * per-tool repeat budget; otherwise `null` (proceed).
 */
export function checkToolCallDedupe(
  signal: AbortSignal,
  toolName: ToolName,
  args: Record<string, unknown>
): ToolResult | null {
  if (EXCLUDED_TOOLS.has(toolName)) return null;

  const signature = toolCallSignature(toolName, args);
  const map = dedupeMap(signal);
  const prev = map.get(signature);
  const count = (prev?.count ?? 0) + 1;
  map.set(signature, { count });

  const max = maxIdenticalDispatches(toolName);
  if (count < max) return null;

  return {
    id: 'dedupe-blocked',
    name: toolName,
    ok: false,
    output:
      `BLOCKED: Tool "${toolName}" was called with identical arguments ${count} times in this run.`,
    error: 'duplicate_tool_call',
    durationMs: 0
  };
}

/**
 * Drop one dedupe signature so a spin-prone re-read can run after a
 * failed edit invalidated the tool-result cache.
 */
export function clearToolCallDedupeSignature(
  signal: AbortSignal,
  toolName: ToolName,
  args: Record<string, unknown>
): void {
  if (EXCLUDED_TOOLS.has(toolName)) return;
  const signature = toolCallSignature(toolName, args);
  dedupeMap(signal).delete(signature);
}

/** Test-only: reset dedupe state for a signal. */
export function __test_resetToolCallDedupe(signal: AbortSignal): void {
  dedupeBySignal.delete(signal);
}
