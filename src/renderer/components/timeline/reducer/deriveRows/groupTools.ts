import type { ToolName } from '@shared/types/tool.js';
import { displayToolName } from '@shared/shell/displayShell.js';
import { computeDiffOps } from '@shared/text/diff/computeDiffHunks.js';
import { getHostPlatform } from '../../../../lib/hostPlatform.js';
import type { ToolGroupChild } from '../deriveRows.js';
export function toolGroupSummary(
  toolName: ToolName,
  children: ToolGroupChild[]
): { verb: string; primary: string; suffix: string } {
  const total = children.length;
  const displayName = displayToolName(toolName, getHostPlatform());
  if (total >= 10) {
    return {
      verb: String(total),
      primary: `${displayName} call${total === 1 ? '' : 's'}`,
      suffix: ''
    };
  }
  const first = children[0];
  const rest = Math.max(0, total - 1);
  const primary = first ? extractPrimary(toolName, first) : '';
  const verb = verbFor(toolName, children.some((c) => c.partial === true && !c.result));
  // Defect 3 (edit only): two edits to the same file previously read
  // as "snake.py and 1 other file" — misleading because there's no
  // OTHER file at all. When every `edit` child targets a single
  // distinct path, switch the unit to "edit/edits" so the wording
  // reflects what actually happened. Other tools keep their existing
  // suffix unchanged.
  let suffix = '';
  if (rest > 0) {
    if (toolName === 'edit' && countDistinctEditPaths(children) === 1) {
      suffix = ` and ${rest} more edit${rest === 1 ? '' : 's'}`;
    } else {
      const unit = unitFor(toolName, rest === 1);
      suffix = ` and ${rest} other ${unit}`;
    }
  }
  return { verb, primary, suffix };
}

/**
 * Count how many distinct file paths an `edit` group's children
 * collectively address. Reads from `call.args.path` first (the
 * pre-result source, populated the moment the tool-call streams in)
 * and falls back to `result.data.filePath` for any child that has
 * already settled. Children with no resolvable path are ignored —
 * they don't contribute to the "same file?" determination.
 */
function countDistinctEditPaths(children: ToolGroupChild[]): number {
  const paths = new Set<string>();
  for (const c of children) {
    const p = editChildPath(c);
    if (p) paths.add(p);
  }
  return paths.size;
}

/**
 * Resolve the file path an `edit` tool-group child targets, preferring
 * the authoritative `result.data.filePath` when settled and falling
 * back to the streamed `call.args.path`. Returns the empty string if
 * neither is populated (e.g. a still-streaming partial with no path
 * key yet).
 *
 * Shared path resolution for edit tool-group children.
 */
export function editChildPath(child: ToolGroupChild | undefined): string {
  if (!child) return '';
  const dataPath =
    child.result?.data?.tool === 'edit' ? child.result.data.filePath : undefined;
  if (typeof dataPath === 'string' && dataPath.length > 0) return dataPath;
  const argPath = child.call?.args?.['path'];
  if (typeof argPath === 'string' && argPath.length > 0) return argPath;
  return '';
}

/**
 * Aggregate diff stats across all children of a tool-group. Three
 * sources fold into the badge:
 *
 *   1. **Settled `file-edit` merge** — `fileEditAdditions` /
 *      `fileEditDeletions` populated by the merge fold in the
 *      `case 'file-edit'` branch of `deriveRows`. The authoritative
 *      number; survives across renders.
 *
 *   2. **Authoritative `tool-result` diff stats** — for an edit that
 *      has settled but whose `file-edit` event hasn't merged yet
 *      (rare race). Falls back to `result.data.additions/deletions`
 *      so the badge isn't blank during the one-frame gap.
 *
 *   3. **Live partial preview** — for synthesised `partial: true`
 *      children, count `+`/`-` lines in the synthesised preview
 *      hunks derived from the streaming `oldString` / `newString`
 *      args. This is what drives the live `+N -M` counter while
 *      the model is still emitting bytes.
 *
 * Returns zeros when no source contributes (e.g. a streaming-only
 * group whose `oldString` hasn't started yet).
 */
export function toolGroupDiffStats(children: ToolGroupChild[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const c of children) {
    // Path 1 — settled file-edit merge.
    if (c.fileEditAdditions !== undefined || c.fileEditDeletions !== undefined) {
      additions += c.fileEditAdditions ?? 0;
      deletions += c.fileEditDeletions ?? 0;
      continue;
    }
    // Path 2 — authoritative result without merge.
    const data = c.result?.data;
    if (data && data.tool === 'edit') {
      additions += data.additions;
      deletions += data.deletions;
      continue;
    }
    // Path 3a — Phase 2 FS-aware live diff snapshot. When the
    // main-process diff streamer has produced authoritative counts
    // against the actual file body, use those directly. Takes
    // precedence over the renderer-side synthesised preview because
    // the FS-aware count reflects real surrounding context (hidden
    // unchanged lines, line numbers, EOL handling).
    if (c.partial && c.diffStream) {
      additions += c.diffStream.additions;
      deletions += c.diffStream.deletions;
      continue;
    }
    // Path 3b — live partial preview synthesised renderer-side from
    // the model's `oldString` / `newString`. Fallback for the
    // pre-`diff-stream` window or for tools / files where the FS
    // path can't compute (e.g. `create: true` against a not-yet-
    // existing path).
    if (c.partial && c.call) {
      const counts = countPartialDiffLines(c.call.args ?? {});
      additions += counts.additions;
      deletions += counts.deletions;
    }
  }
  return { additions, deletions };
}

/**
 * Count `+` / `-` lines that the renderer-side preview synthesiser
 * would produce for a streaming `edit` call's partial args. Mirrors
 * the LCS-based `synthesizeDiffPreview` exactly so the rolled-up
 * `+N -M` badge always agrees with what the expanded preview shows
 * line-for-line.
 *
 *   - `create: true` + partial `content` → every line in the
 *     accumulated content is a `+` line.
 *   - `oldString` + `newString` → run through the shared
 *     `computeDiffHunks` (same call the renderer makes when it
 *     paints the preview) and count `+` / `-` lines emitted.
 *     Unchanged lines are NOT counted — Phase 1.2 fix: the
 *     pre-1.2 implementation just split both strings and called
 *     every line a delete or an add, which inflated the badge for
 *     typo-sized edits where most lines were anchor context.
 *
 * Pure helper, called from `toolGroupDiffStats` on each render.
 * Bounded cost: the strings are the model's `oldString` /
 * `newString` only, never the full file body.
 */
function countPartialDiffLines(args: Record<string, unknown>): {
  additions: number;
  deletions: number;
} {
  if (args['create'] === true) {
    const content = args['content'];
    if (typeof content !== 'string' || content.length === 0) {
      return { additions: 0, deletions: 0 };
    }
    return { additions: content.split('\n').length, deletions: 0 };
  }
  const oldString = args['oldString'];
  const newString = args['newString'];
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return { additions: 0, deletions: 0 };
  }
  if (oldString.length === 0 && newString.length === 0) {
    return { additions: 0, deletions: 0 };
  }
  // Use `computeDiffOps` (the unsegmented LCS walk) so the count
  // matches `synthesizeDiffPreview` line-for-line. The hunk-
  // segmenter in `computeDiffHunks` is for surrounding-context
  // rendering — counting through it would either skip context
  // lines (which we don't want to count anyway) or, with
  // `context = 0`, truncate trailing changes after a context
  // anchor. The flat op list avoids both pitfalls.
  const ops = computeDiffOps(oldString, newString);
  let additions = 0;
  let deletions = 0;
  for (const l of ops.lines) {
    if (l.kind === '+') additions++;
    else if (l.kind === '-') deletions++;
  }
  return { additions, deletions };
}

/**
 * Last in-flight `edit` child in a tool-group. When several sequential
 * edits target the same file, only the tail child should live
 * auto-expand so the timeline does not stack three full streaming diffs.
 */
export function tailInFlightEditChildIndex(children: ToolGroupChild[]): number | null {
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i]!;
    if (c.result) continue;
    if (c.partial === true || c.diffStream != null || c.call != null) return i;
  }
  return null;
}

function verbFor(name: ToolName, pending = false): string {
  if (pending) {
    switch (name) {
      case 'bash': return 'Running';
      case 'read': return 'Reading';
      case 'ls': return 'Listing';
      case 'edit': return 'Editing';
      case 'delete': return 'Deleting';
      // `search` is local-only (SearchData.mode is always 'local'), so the
      // verb is always the grep form — no remote-search branch.
      case 'search': return 'Grepping';
      case 'memory': return 'Memory';
      case 'recall': return 'Recalling';
      case 'report': return 'Writing';
      case 'ask_user': return 'Asking';
      case 'finish': return '';
      case 'unknown': return 'Running';
    }
  }
  switch (name) {
    case 'bash': return 'Ran';
    case 'read': return 'Read';
    case 'ls': return 'Listed';
    case 'edit': return 'Edited';
    case 'delete': return 'Deleted';
    case 'search': return 'Grepped';
    case 'memory': return 'Memory';
    case 'recall': return 'Recalled';
    case 'report': return 'Wrote';
    case 'ask_user': return 'Asked';
    case 'finish': return '';
    case 'unknown': return 'Unknown tool';
  }
}

function unitFor(name: ToolName, singular: boolean): string {
  switch (name) {
    case 'bash': return singular ? 'command' : 'commands';
    case 'read': return singular ? 'file' : 'files';
    case 'ls': return singular ? 'path' : 'paths';
    case 'edit': return singular ? 'file' : 'files';
    case 'delete': return singular ? 'file' : 'files';
    case 'search': return singular ? 'query' : 'queries';
    case 'memory': return singular ? 'note' : 'notes';
    case 'recall': return singular ? 'conversation' : 'conversations';
    case 'report': return singular ? 'report' : 'reports';
    case 'ask_user': return singular ? 'question' : 'questions';
    case 'finish': return singular ? 'answer' : 'answers';
    case 'unknown': return singular ? 'invocation' : 'invocations';
  }
}

function extractPrimary(name: ToolName, child: ToolGroupChild): string {
  const args = child.call?.args ?? {};
  const data = child.result?.data;
  switch (name) {
    case 'bash': {
      const cmd =
        typeof args['command'] === 'string'
          ? (args['command'] as string)
          : data?.tool === 'bash'
            ? data.command
            : '';
      return cmd;
    }
    case 'read':
    case 'ls':
    case 'edit':
    case 'delete': {
      const raw =
        typeof args['path'] === 'string'
          ? (args['path'] as string)
          : data?.tool === name && 'path' in data
            ? (data as { path: string }).path
            : data?.tool === 'edit'
              ? data.filePath
              : data?.tool === 'delete'
                ? data.filePath
                : '';
      // The agent often passes `.` (or empty) to mean the workspace
      // root. Surface that intent verbally instead of rendering a
      // stray period after the verb (`Listed .` → `Listed workspace`).
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed === '.' || trimmed === './') {
        if (name === 'ls') return 'workspace';
        // Path-less read/edit/delete calls fail validation; surface the
        // error in the collapsed group instead of "Read and N other files".
        if (
          (name === 'read' || name === 'edit' || name === 'delete') &&
          child.result &&
          !child.result.ok
        ) {
          return child.result.error ?? 'missing path';
        }
        return trimmed;
      }
      return raw;
    }
    case 'search': {
      const mode =
        args['mode'] === 'structural' || (data?.tool === 'search' && data.mode === 'structural')
          ? 'structural'
          : 'local';
      if (mode === 'structural') return 'Structural search';
      const q =
        typeof args['query'] === 'string'
          ? (args['query'] as string)
          : data?.tool === 'search'
            ? data.query
            : '';
      return q;
    }
    case 'memory': {
      const action =
        typeof args['action'] === 'string'
          ? (args['action'] as string)
          : data?.tool === 'memory'
            ? data.action
            : '';
      const key =
        typeof args['key'] === 'string'
          ? (args['key'] as string)
          : data?.tool === 'memory' && data.key
            ? data.key
            : '';
      return key ? `${action} ${key}` : action;
    }
    case 'recall': {
      // Surface the action; for `read`, also show a short id prefix so
      // collapsed groups carry the breadcrumb without printing a 36-
      // char UUID.
      const action =
        typeof args['action'] === 'string'
          ? (args['action'] as string)
          : data?.tool === 'recall'
            ? data.action
            : '';
      const targetId =
        typeof args['conversationId'] === 'string'
          ? (args['conversationId'] as string)
          : data?.tool === 'recall' && data.conversationId
            ? data.conversationId
            : '';
      if (action === 'read' && targetId) {
        return `read ${targetId.slice(0, 8)}…`;
      }
      return action;
    }
    case 'report': {
      const title =
        typeof args['title'] === 'string'
          ? (args['title'] as string)
          : data?.tool === 'report'
            ? data.title
            : '';
      return title;
    }
    case 'ask_user':
      return typeof args['question'] === 'string' ? (args['question'] as string) : '';
    case 'finish':
      return '';
    case 'unknown': {
      // Surface whatever name the call/result reported (or empty if both
      // are also `'unknown'`) so the rolled-up row remains informative.
      const callName = child.call?.name;
      const resultName = child.result?.name;
      if (callName && callName !== 'unknown') return callName;
      if (resultName && resultName !== 'unknown') return resultName;
      return '';
    }
  }
}

/**
 * Derive the overall status for a tool group. Mirrors the per-row status
 * logic: running if any child is still in-flight, failed if any child's
 * result is !ok, otherwise done.
 */
export function toolGroupStatus(children: ToolGroupChild[]): 'running' | 'done' | 'failed' {
  let anyFailed = false;
  for (const c of children) {
    if (!c.result) return 'running';
    if (!c.result.ok) anyFailed = true;
  }
  return anyFailed ? 'failed' : 'done';
}

