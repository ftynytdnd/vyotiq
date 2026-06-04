/**
 * `synthesizeCreateHunks` — turn a "full file content" string into a
 * single hunk where every line is a `+` line. The structural shape
 * of "this entire file is brand-new content".
 *
 * Single source of truth shared by:
 *
 *   - `src/main/orchestrator/diffStreamer.ts` (Phase 3) — for the
 *     FS-aware live diff streamer's create-true emit path. The
 *     streamer can't read a non-existent file, so a sub-agent
 *     `edit` call with `create: true` would otherwise have no
 *     `diff-stream` event firing, leaving `ToolGroupRow.liveAutoExpand`
 *     and every other "are we live?" predicate false. Emitting these
 *     hunks gives the renderer the same auto-expand + per-line
 *     streaming UX it already gets for modify edits, with no FS
 *     read needed.
 *
 *   - `src/renderer/components/timeline/tools/edit/synthesizeDiffPreview.ts`
 *     (Phase 1.2) — for the renderer-side preview of the same
 *     create-true call. Used directly when the partial-args parser
 *     produces a `content` snapshot before main has emitted, and as
 *     the visible body of the `EditDiffView` for both pre-result
 *     `create-preview` panes and settled `data.createdContent` panes.
 *
 *   - `src/renderer/components/checkpoints/PendingChangeDiff.tsx`
 *     (timeline pending-change rows) — for the
 *     `kind: 'create'` branch so a created file's snapshot blob
 *     reads as a green-tinted diff rather than a muted plain-text
 *     wall.
 *
 * Splitting rule mirrors `computeDiffOps`: `content.split('\n')`.
 * A single trailing newline therefore surfaces as a trailing empty
 * `+` line — that's the same shape an authoritative post-edit hunk
 * would produce for the same content, so the preview → settle
 * transition is byte-identical at the line level (no remount mid-
 * flight).
 *
 * Streaming-safe: re-runs on every cumulative `content` snapshot
 * the partial-JSON parser produces; React's keyed-list
 * reconciliation handles the line growth without remounting.
 *
 * Pure function — no IO, no DOM, no React. Safe to import from any
 * runtime (main, renderer, worker thread).
 */

import type { DiffHunk } from '../../types/tool.js';

export function synthesizeCreateHunks(content: string): DiffHunk[] {
  const lines = content.split('\n').map((text) => ({ kind: '+' as const, text }));
  return [{ oldStart: 1, newStart: 1, lines }];
}
