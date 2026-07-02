/**
 * Tracks identical pre-dispatch validation failures per run.
 *
 * Malformed repeats should not burn iterations forever without tripping
 * dedupe (validation runs before dispatch). After two identical failures,
 * return a pivot message aligned with duplicate_tool_call copy.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import { toolCallSignature } from './loop/toolSpinSignature.js';

const MAX_IDENTICAL_VALIDATION_FAILURES = 2;

const bySignal = new WeakMap<AbortSignal, Map<string, number>>();

function failureMap(signal: AbortSignal): Map<string, number> {
  let map = bySignal.get(signal);
  if (!map) {
    map = new Map();
    bySignal.set(signal, map);
  }
  return map;
}

/**
 * Returns a blocked result when the same tool+args failed validation too
 * many times; otherwise records the attempt and returns null (proceed with
 * the first-pass validation error).
 */
export function checkValidationRepeat(
  signal: AbortSignal,
  toolName: ToolName,
  args: Record<string, unknown>,
  validationOutput: string
): ToolResult | null {
  const signature = toolCallSignature(toolName, args);
  const map = failureMap(signal);
  const count = (map.get(signature) ?? 0) + 1;
  map.set(signature, count);

  if (count < MAX_IDENTICAL_VALIDATION_FAILURES) return null;

  const preview =
    validationOutput.length > 200 ? `${validationOutput.slice(0, 197)}…` : validationOutput;

  return {
    id: 'validation-repeat-blocked',
    name: toolName,
    ok: false,
    output:
      `BLOCKED: "${toolName}" failed validation ${count} times with identical arguments. ` +
      `Fix the arguments before retrying. Last error: ${preview}`,
    error: 'validation_repeat',
    durationMs: 0
  };
}

/** Test-only: reset validation tracking for a signal. */
export function __test_resetValidationFailureTracker(signal: AbortSignal): void {
  bySignal.delete(signal);
}
