/**
 * Per-run guard against identical tool+args spam.
 *
 * Spin-prone tools (`read`, `bash`, `search`, `ls`) block on the second
 * identical dispatch so the model cannot cache-loop through a third repeat.
 * Other tools allow two attempts then block.
 */

import type { ToolResult } from '@shared/types/tool.js';
import type { ToolName } from '@shared/types/tool.js';
import { toolCallSignature } from './loop/toolSpinSignature.js';

const MAX_IDENTICAL_DISPATCHES_DEFAULT = 3;
const MAX_IDENTICAL_DISPATCHES_SPIN_PRONE = 2;

const EXCLUDED_TOOLS = new Set<string>(['finish', 'ask_user']);

const SPIN_PRONE_TOOLS = new Set<string>(['read', 'bash', 'search', 'ls']);

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

  const pivotHint = isSpinProneTool(toolName)
    ? ' Pivot to `edit`, `ask_user`, or a different path — do not re-read the same file.'
    : ' Change your approach or arguments before trying again.';

  return {
    id: 'dedupe-blocked',
    name: toolName,
    ok: false,
    output:
      `BLOCKED: Tool "${toolName}" was called with identical arguments ${count} times in this run.${pivotHint}`,
    error: 'duplicate_tool_call',
    durationMs: 0
  };
}

/** Test-only: reset dedupe state for a signal. */
export function __test_resetToolCallDedupe(signal: AbortSignal): void {
  dedupeBySignal.delete(signal);
}
