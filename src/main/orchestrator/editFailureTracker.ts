/**
 * Tracks identical post-dispatch edit `no match` failures per run.
 *
 * Blocks the model from burning iterations on the same stale anchor
 * after two identical (path, oldString) failures.
 */

import type { ToolResult } from '@shared/types/tool.js';

/** Allow two real `no match` failures before blocking the next attempt. */
const MAX_IDENTICAL_EDIT_FAILURES = 2;

const bySignal = new WeakMap<AbortSignal, Map<string, number>>();

function failureMap(signal: AbortSignal): Map<string, number> {
  let map = bySignal.get(signal);
  if (!map) {
    map = new Map();
    bySignal.set(signal, map);
  }
  return map;
}

function editAnchorSignature(path: string, oldString: string): string {
  return `${path}\0${oldString}`;
}

function blockedEditNoMatchResult(path: string, count: number): ToolResult {
  return {
    id: 'edit-repeat-blocked',
    name: 'edit',
    ok: false,
    output:
      `BLOCKED: "edit" failed with \`oldString\` not found ${count} times on ${path} ` +
      `with identical arguments. Re-read the file with \`read\`, copy exact bytes ` +
      `(strip line-number prefixes), widen context, then edit with a fresh anchor.`,
    error: 'edit_no_match_repeat',
    durationMs: 0
  };
}

/**
 * Read-only pre-dispatch check: block when the same anchor already failed
 * with `no match` twice (third attempt).
 */
export function shouldBlockEditNoMatchRepeat(
  signal: AbortSignal,
  path: string,
  oldString: string
): ToolResult | null {
  const count = failureMap(signal).get(editAnchorSignature(path, oldString)) ?? 0;
  if (count < MAX_IDENTICAL_EDIT_FAILURES) return null;
  return blockedEditNoMatchResult(path, count);
}

/** Record a post-dispatch `no match` failure for an edit anchor. */
export function recordEditNoMatchFailure(
  signal: AbortSignal,
  path: string,
  oldString: string
): void {
  const signature = editAnchorSignature(path, oldString);
  const map = failureMap(signal);
  map.set(signature, (map.get(signature) ?? 0) + 1);
}

/** Test-only: reset edit failure tracking for a signal. */
export function __test_resetEditFailureTracker(signal: AbortSignal): void {
  bySignal.delete(signal);
}
