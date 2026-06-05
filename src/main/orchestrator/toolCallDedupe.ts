/**
 * Per-run guard against identical tool+args spam. Blocks the third
 * dispatch of the same signature in a run (after two allowed attempts).
 * Complements `toolResultCache` (read memoization) without restoring the
 * removed spin-detector halt.
 */

import type { ToolResult } from '@shared/types/tool.js';
import type { ToolName } from '@shared/types/tool.js';
import { toolCallSignature } from './loop/toolSpinSignature.js';

const MAX_IDENTICAL_DISPATCHES = 3;

const EXCLUDED_TOOLS = new Set<string>(['finish', 'ask_user']);

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
 * Returns a blocked `ToolResult` when the same tool+args was already
 * dispatched twice in this run; otherwise `null` (proceed).
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

  if (count < MAX_IDENTICAL_DISPATCHES) return null;

  return {
    id: 'dedupe-blocked',
    name: toolName,
    ok: false,
    output:
      `BLOCKED: Tool "${toolName}" was called with identical arguments ${count} times in this run. ` +
      'Change your approach or arguments before trying again.',
    error: 'duplicate_tool_call',
    durationMs: 0
  };
}

/** Test-only: reset dedupe state for a signal. */
export function __test_resetToolCallDedupe(signal: AbortSignal): void {
  dedupeBySignal.delete(signal);
}
