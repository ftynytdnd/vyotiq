/**
 * Pure helper that turns an `edit` tool call's already-parsed
 * arguments into a *predictive* diff structure the renderer can
 * paint BEFORE the tool actually runs.
 *
 * Why this exists:
 *   The orchestrator emits a `tool-call` event the moment a tool
 *   call's streamed arguments finish parsing, but the matching
 *   `tool-result` (which carries the authoritative `data.hunks`)
 *   doesn't land until the tool has been dispatched through the
 *   sandbox resolver, file system, match logic, and write step.
 *   For an `edit` call that gap is the perceptible "what's it
 *   doing right now?" window in the timeline.
 *
 *   The call's own `oldString` / `newString` (or `content` for
 *   `create: true`) describe the intended change completely.
 *   Rendering them as a synthetic one-hunk diff lets the user see
 *   the agent's intent immediately; when the real `tool-result`
 *   arrives the EditInvocation swaps the preview for the
 *   authoritative hunks.
 *
 * Phase 1.2 upgrade — real LCS line diff:
 *   The previous implementation produced a single hunk that listed
 *   every line of `oldString` as `-` followed by every line of
 *   `newString` as `+`. That read as a wall of red+green for any
 *   typo-sized edit and stripped all unchanged lines from the
 *   preview. This module now delegates to the shared
 *   `computeDiffHunks` (the same algorithm the authoritative
 *   `tool-result.data.hunks` is built from), so:
 *     - Identical lines render as ` ` context lines.
 *     - Closely-spaced edits land in one hunk; spread-out edits
 *       land in separate hunks.
 *     - The diff is structurally meaningful enough that intra-line
 *       word highlighting becomes useful.
 *   Stable contract is preserved: `oldStart` / `newStart` stay at
 *   `1` because we don't yet know the real line offsets in the
 *   on-disk file (that comes with the authoritative `tool-result`).
 *
 * Contract:
 *   - **Total.** Never throws. Pathological inputs return `null`
 *     and the renderer falls back to the existing "no detail yet"
 *     path. Defensive against the `parseToolArgs` fallback in
 *     `handleToolCalls.ts` that collapses malformed args to `{}`.
 *   - **Pure.** No DOM, no IO, no React. Safe to call from a
 *     `useMemo` factory.
 *   - **Side-effect free.** No mutation of the input args object.
 *   - **Streaming-safe.** The streaming pipeline feeds in cumulative
 *     `oldString` / `newString` snapshots from the partial-JSON
 *     parser; each snapshot is structurally complete (the parser
 *     omits keys whose value is mid-token), so `computeDiffHunks`
 *     always sees fully-formed strings.
 *
 * Notes on the synthesized hunk:
 *   - Line numbers are unknown pre-execution, so the first hunk's
 *     `oldStart` and `newStart` are both `1`. The authoritative
 *     `data.hunks` from the tool result will carry the real
 *     positions when they replace the preview.
 *   - A no-op edit (oldString identical to newString) returns
 *     `null` — the tool itself rejects that case, and a diff where
 *     every line is both added and removed would only confuse
 *     users.
 *   - `replaceAll: true` is surfaced as a boolean marker; the
 *     count of replacements is unknown until the tool runs, so the
 *     renderer labels it as "all occurrences" rather than printing
 *     a number it doesn't have.
 */

import type { DiffHunk } from '@shared/types/tool.js';
import { computeDiffOps } from '@shared/text/diff/computeDiffHunks.js';
import { synthesizeCreateHunks } from '@shared/text/diff/synthesizeCreateHunks.js';

export type DiffPreview =
  | { kind: 'edit-preview'; hunks: DiffHunk[]; replaceAll: boolean }
  | { kind: 'create-preview'; content: string; hunks: DiffHunk[] };

/**
 * Re-export of the shared all-`+` hunk synthesiser. The implementation
 * lives in `@shared/text/diff/synthesizeCreateHunks.ts` because main's
 * `DiffStreamer` live create streaming needs the
 * same algorithm to emit `diff-stream` events with all-`+` hunks for
 * `create: true` calls (no on-disk body to diff against). Single
 * source of truth keeps the preview-emit shape byte-identical across
 * main and renderer so the partial → settled transition never causes
 * a hunk-shape remount.
 *
 * Re-exported here so existing renderer code keeps the same import
 * path; consumers in main MUST import from `@shared/text/diff/...`
 * directly.
 */
export { synthesizeCreateHunks };

/** Total — returns `null` instead of throwing on bad input. */
export function synthesizeDiffPreview(
  args: Record<string, unknown> | undefined | null
): DiffPreview | null {
  if (!args || typeof args !== 'object') return null;

  // `path` is required by the underlying `edit` tool but its absence
  // is not fatal for the preview — we still build the hunk from the
  // strings the model intended to apply. The renderer needs the path
  // for the row label, not for the preview body.

  // CREATE branch. Take precedence over the edit branch because the
  // `create: true` + `oldString` co-occurrence is technically
  // invalid (the tool would reject) but we'd rather show the
  // intended new content than a misleading edit diff.
  const create = args['create'];
  if (create === true) {
    const content = args['content'];
    if (typeof content !== 'string' || content.length === 0) return null;
    return {
      kind: 'create-preview',
      content,
      hunks: synthesizeCreateHunks(content)
    };
  }

  // EDIT branch.
  const oldString = args['oldString'];
  const newString = args['newString'];
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return null;
  }
  if (oldString === newString) return null; // tool would reject this anyway

  // Real LCS-based diff. The model's `oldString`/`newString` carry
  // the entire intended span — we WANT every unchanged anchor line
  // visible (that's the agent's chosen context), so we use
  // `computeDiffOps` for the flat op list and wrap in a single
  // hunk instead of going through `computeDiffHunks` which would
  // hide unchanged lines beyond the configured context window.
  const ops = computeDiffOps(oldString, newString);
  if (ops.lines.length === 0) {
    // Both strings are empty (the parent guards `oldString.length`
    // earlier, so this is defensive only). Treat as no-op.
    return null;
  }
  // No structural change at the line level — every op was ` `.
  // Caller treats `null` as "render the existing 'no detail yet'
  // path" so the user doesn't see an empty diff card.
  if (!ops.lines.some((l) => l.kind === '+' || l.kind === '-')) {
    return null;
  }
  const hunk: DiffHunk = {
    // Real positions land with the authoritative `tool-result`.
    oldStart: 1,
    newStart: 1,
    lines: ops.lines
  };
  return {
    kind: 'edit-preview',
    hunks: [hunk],
    replaceAll: args['replaceAll'] === true
  };
}
