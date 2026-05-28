/**
 * Bespoke renderer for the `edit` tool. Four precedence-ordered
 * detail-pane states, all rendered through the shared `EditDiffView`
 * so the visual rhythm is identical across them:
 *
 *   1. **Authoritative diff** — `result.data.hunks` from a successful
 *      tool execution (or `data.createdContent` for `create: true`).
 *      Pane label: `diff` / `created content`. Variant:
 *      `authoritative` (plays the staggered settle animation when it
 *      mounts).
 *
 *   2. **Failed call with intended diff** — `result.ok === false` and
 *      the call's args still describe a synthesizable preview
 *      (`oldString` + `newString`, or `create: true` + `content`).
 *      Renders BOTH the error pane (with the actionable `output`,
 *      not the short `error` tag — defect 2) AND a synthetic preview
 *      labelled `intended diff (not applied)` so the user can see
 *      exactly what the model TRIED to do.
 *
 *   3. **Pre-result preview** — `tool-call` event landed, matching
 *      `tool-result` not yet received. Synthesized from the call's
 *      own arguments via `synthesizeDiffPreview`. Pane label:
 *      `preview (pending)` / `new file (pending)`. The row header
 *      uses typography-only in-flight styling; no extra motion on
 *      the diff stats badge.
 *
 *   4. **No detail** — call has no synthesizable args and no result
 *      yet. Row collapses without an expand affordance, matching the
 *      previous behaviour for malformed / minimal calls.
 *
 * Title slot: always `"edit"` (consistent with `read`, `ls`, …).
 * The icon distinguishes `create` (FilePlus) from `edit` (PencilLine)
 * so the title never doubles up the verb — fixes the "edit edit
 * snake.py" duplication that defect 1 documented.
 */

import { useMemo } from 'react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import type { DiffStreamSnapshot } from '../reducer/types.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DiffStreamPane } from './shared/DiffStreamPane.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';
import { DetailPane } from './shared/DetailPane.js';
import { DiffStatsBadge } from './shared/DiffStatsBadge.js';
import { CodeBlock } from './shared/CodeBlock.js';
import { EditDiffView } from './edit/EditDiffView.js';
import { PendingEntryDot } from '../../checkpoints/shared/PendingEntryDot.js';
import { usePendingEntryState } from '../../checkpoints/shared/usePendingEntryState.js';
import {
  synthesizeCreateHunks,
  synthesizeDiffPreview,
  type DiffPreview
} from './edit/synthesizeDiffPreview.js';

interface EditInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
  /**
   * True when this invocation was synthesised from streaming
   * `tool-call-args-delta` events — i.e. the args are a best-effort
   * partial-JSON snapshot, the file system hasn't been touched, and
   * the authoritative `tool-call` hasn't arrived yet. The renderer
   * switches into a `partial` diff variant (trailing cursor on the
   * streaming line, live `+N -M` counter) so the user sees the
   * agent's intent the moment bytes start arriving.
   */
  partial?: boolean;
  /**
   * Phase 2 — main-process FS-aware live diff. When present, the
   * pane prefers these hunks (computed against the actual on-disk
   * file body) over the renderer-side `synthesizeDiffPreview`
   * output. The synthesised preview remains the fallback for the
   * pre-`diff-stream` window (first frame), for `create: true`
   * calls (no on-disk body to diff against), and for cases where
   * the streamer couldn't read the target (path outside workspace,
   * file too large, etc.).
   */
  diffStream?: DiffStreamSnapshot;
  retryCount?: number;
  /** Parent override — e.g. tool-group tail in-flight edit only. */
  liveAutoExpand?: boolean;
  groupExpanded?: boolean;
}

export function EditInvocation({
  call,
  result,
  dense,
  rowKey,
  partial,
  diffStream,
  retryCount,
  liveAutoExpand: liveAutoExpandOverride,
  groupExpanded
}: EditInvocationProps) {
  const data = result?.data?.tool === 'edit' ? result.data : null;
  const argCreate = call?.args?.['create'] === true;
  const argPath =
    typeof call?.args?.['path'] === 'string' ? (call.args['path'] as string) : '';
  const path = data?.filePath ?? argPath;

  // The call's own arguments are enough to synthesize a predictive
  // diff. Memoised on the args reference so re-renders during
  // streaming args updates don't re-walk the buffers. Total — returns
  // null instead of throwing on bad input, so we never need a
  // try/catch in the render path.
  const preview: DiffPreview | null = useMemo(
    () => synthesizeDiffPreview(call?.args ?? null),
    [call?.args]
  );
  const visibleDiffStream =
    diffStream && diffStream.tool === 'edit' && diffStream.hunks.length > 0
      ? diffStream
      : null;

  // Defect 1: the summary slot must NOT prefix the verb. The shared
  // `InvocationShell` already carries the tool name in its title
  // slot — a `${verb} ${path}` summary produced the duplicated
  // "edit edit snake.py" / "create create new.ts" rendering that
  // showed up in the screenshot. The icon switch above is what
  // tells the user this is a create vs a modify, so the summary
  // can stay path-only (matches `ReadInvocation` / `LsInvocation`).
  const summary =
    path && retryCount && retryCount > 1 ? `${path} · ${retryCount} tries` : path ? path : 'edit';

  // Defect 2: `result.error` is a short tag ("ambiguous",
  // "no match", "missing path", …) intended for the collapsed
  // `errorHint` breadcrumb. The danger pane wants the
  // *actionable* message that lives in `result.output`. Prefer
  // output when it's non-empty; fall back to the tag only when
  // the tool didn't populate output.
  const errorHint = toolErrorHint(result);
  const errorBody = toolErrorBody(result);

  // ───────────────────────────────────────────────────────────
  // Detail pane composition — four precedence-ordered branches.
  // ───────────────────────────────────────────────────────────
  let detail: React.ReactNode = undefined;

  if (data) {
    // (1) Authoritative — existing behaviour, now flowing through
    // `EditDiffView` so the preview / authoritative paths share
    // the same Hunk renderer.
    detail = (
      <>
        <div className="flex items-center gap-2 text-row text-text-muted">
          <span className="font-mono truncate" title={data.filePath}>
            {data.filePath}
          </span>
          <DiffStatsBadge additions={data.additions} deletions={data.deletions} />
          {data.replacedOccurrences && data.replacedOccurrences > 1 && (
            <span className="text-text-faint">
              {data.replacedOccurrences} replacements
            </span>
          )}
        </div>
        {data.created && data.createdContent !== undefined && (
          // Render the full new-file body as an all-`+` hunk via
          // the shared `EditDiffView` so created files carry the
          // same green tint + `+` markers + per-line numbering
          // that modify edits use. Pre-fix this branch dumped the
          // body through `CodeBlock tone="muted"`, producing a
          // muted plain-text wall that didn't read as a diff at
          // all — that's the "what the fuck is wrong with these
          // diffs?" surface in the pending-changes panel screenshot.
          <DetailPane label="diff">
            <EditDiffView
              key="authoritative"
              hunks={synthesizeCreateHunks(data.createdContent)}
              variant="authoritative"
            />
          </DetailPane>
        )}
        {!data.created && data.hunks && data.hunks.length > 0 && (
          // `key="authoritative"` re-fires the settle animation
          // when the preview tree unmounts and this tree mounts.
          <DetailPane label="diff">
            <EditDiffView
              key="authoritative"
              hunks={data.hunks}
              variant="authoritative"
            />
          </DetailPane>
        )}
        {!data.created && (!data.hunks || data.hunks.length === 0) && (
          <div className="text-row text-text-muted">No textual changes.</div>
        )}
      </>
    );
  } else if (result && !result.ok) {
    // (2) Failed call. Render the actionable error pane plus —
    // when the args still describe a synthesizable preview — an
    // `intended diff (not applied)` pane so the user sees what
    // the model was trying to do.
    detail = (
      <>
        <DetailPane label="error" tone="danger">
          <CodeBlock body={errorBody} tone="danger" />
        </DetailPane>
        {preview && (
          // Always route through `EditDiffView` (both edit-preview
          // and create-preview branches carry hunks now), so the
          // failed-create case shows the intended new-file body as
          // green `+` lines — same visual rhythm as the failed-modify
          // case.
          <DetailPane label="intended diff (not applied)" tone="danger">
            <EditDiffView
              key={preview.kind === 'edit-preview' ? 'preview-failed' : 'new-file-failed'}
              hunks={preview.hunks}
              variant="preview"
            />
          </DetailPane>
        )}
      </>
    );
  } else if (visibleDiffStream && !argCreate) {
    detail = (
      <DiffStreamPane
        diffStream={visibleDiffStream}
        label={visibleDiffStream.settled ? 'live diff' : 'streaming diff'}
      />
    );
  } else if (preview) {
    // (3b) Pre-result preview. Result hasn't landed yet AND the
    // FS-aware streamer hasn't produced a snapshot yet (or this is
    // a `create: true` call against a non-existent path); surface
    // the call's intent so the user has more than a path-only row
    // path to look at. Tagged `partial` when the upstream tool-group
    // child carries the partial flag — i.e. the args were a
    // streaming partial-JSON snapshot. That switches the diff into
    // the live-streaming variant (trailing cursor + live counter).
    detail =
      preview.kind === 'edit-preview' ? (
        <DetailPane label={partial ? 'streaming…' : 'preview (pending)'}>
          <EditDiffView
            key={partial ? 'preview-partial' : 'preview-pending'}
            hunks={preview.hunks}
            variant={partial ? 'partial' : 'preview'}
          />
          {preview.replaceAll && (
            <div className="mt-1 text-meta italic text-text-faint">
              (replace all occurrences)
            </div>
          )}
        </DetailPane>
      ) : (
        // Created-file preview. Routed through `EditDiffView` (same
        // surface as modify previews) so the new-file body renders
        // as a wall of green `+` lines — the visual signal "this is
        // a brand new file landing live". The streaming variant
        // carries the trailing `vyotiq-stream-cursor` on the last
        // line, so as more partial-JSON `content` arrives the user
        // SEES the lines materialise with the blinking caret. Pre-
        // fix this branch went through `CodeBlock tone="muted"`,
        // which is what the user was looking at when they said
        // "it does not visually stream them live at all".
        <DetailPane label={partial ? 'new file streaming…' : 'new file (pending)'}>
          <EditDiffView
            key={partial ? 'new-file-partial' : 'new-file-pending'}
            hunks={preview.hunks}
            variant={partial ? 'partial' : 'preview'}
          />
        </DetailPane>
      );
  }
  // (4) No-detail branch: leave `detail = undefined` so
  // `InvocationShell` disables the expand affordance.

  // Live-stream auto-expand. The shell auto-opens while the call is
  // streaming an FS-aware diff or a synthesised partial preview, so
  // the user sees the hunks materialise without clicking. Surrenders
  // to manual override the moment the user toggles the row, then
  // collapses naturally on settle when the upstream `partial` flag
  // and `diffStream` slot both clear (`liveAutoExpand` becomes
  // `false`). Mirrors the parent `ToolGroupRow`'s auto-expand so
  // the two layers move together. Renderer-side preview is enough
  // to flip the signal even when the FS-aware streamer hasn't
  // landed a frame yet (rare but possible).
  const computedLiveAutoExpand =
    !dense &&
    !result &&
    (partial === true || diffStream != null || preview != null || call != null);
  const liveAutoExpand = liveAutoExpandOverride ?? computedLiveAutoExpand;

  const pending = usePendingEntryState({
    ...(data?.entryId ? { entryId: data.entryId } : {}),
    filePath: path
  });
  const actions =
    data && result?.ok && pending ? <PendingEntryDot className="mr-0.5" /> : undefined;

  return (
    <InvocationShell
      title="edit"
      summary={summary}
      mono
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
      liveAutoExpand={liveAutoExpand}
      {...(groupExpanded ? { groupExpanded } : {})}
      {...(actions ? { actions } : {})}
      call={call}
      result={result}
      partial={partial}
    />
  );
}
