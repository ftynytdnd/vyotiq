/**
 * `deriveRows` — edit-tool-group + file-edit-group merge fold.
 *
 * The orchestrator emits THREE events per successful edit (`tool-call`,
 * `tool-result`, `file-edit`); the deriver used to surface them as TWO
 * timeline rows — the tool-group's "Edited path" line immediately
 * followed by a near-identical file-edit-group's "Edited path +N -M"
 * line. That duplication is documented in the screenshot pass on the
 * implementation plan.
 *
 * After the fold:
 *   - A successful edit produces ONE `tool-group(edit)` row whose
 *     child carries `fileEditAdditions` / `fileEditDeletions`.
 *   - A failed edit (no `file-edit` event) still produces ONE row
 *     with the error chip and no diff stats.
 *   - A bash mutation followed by a bare `file-edit` (no preceding
 *     edit tool-group) keeps the legacy `file-edit-group` path —
 *     mutation sources outside the edit tool must not regress.
 */

import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import type { TimelineEvent } from '@shared/types/chat';

const editToolCall = (callId: string, path: string, ts: number): TimelineEvent => ({
  kind: 'tool-call',
  id: `c-${callId}`,
  ts,
  call: {
    id: callId,
    name: 'edit',
    args: { path, oldString: 'a', newString: 'b' }
  }
});

const editToolResult = (
  callId: string,
  path: string,
  ts: number,
  ok = true
): TimelineEvent => ({
  kind: 'tool-result',
  id: `r-${callId}`,
  ts,
  result: ok
    ? {
        id: callId,
        name: 'edit',
        ok: true,
        output: 'edited',
        durationMs: 1,
        data: {
          tool: 'edit',
          filePath: path,
          additions: 1,
          deletions: 1,
          created: false,
          hunks: []
        }
      }
    : {
        id: callId,
        name: 'edit',
        ok: false,
        output: 'Error: ambiguous',
        error: 'ambiguous',
        durationMs: 1
      }
});

const fileEdit = (path: string, ts: number, additions = 1, deletions = 1): TimelineEvent => ({
  kind: 'file-edit',
  id: `fe-${path}-${ts}`,
  ts,
  filePath: path,
  additions,
  deletions
});

describe('deriveRows — edit + file-edit merge fold', () => {
  it('folds a successful edit + matching file-edit into one row', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      fileEdit('src/foo.ts', 4, 3, 2)
    ];
    const rows = deriveRows(events);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    const fileEditGroups = rows.filter((r) => r.kind === 'file-edit-group');
    expect(toolGroups.length).toBe(1);
    expect(fileEditGroups.length).toBe(0);
    const tg = toolGroups[0]!;
    if (tg.kind !== 'tool-group') throw new Error('narrow');
    expect(tg.children.length).toBe(1);
    expect(tg.children[0]!.fileEditAdditions).toBe(3);
    expect(tg.children[0]!.fileEditDeletions).toBe(2);
  });

  it('keeps a failed edit as a single tool-group with no diff stats', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3, false)
      // no file-edit — the tool refused to write
    ];
    const rows = deriveRows(events);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    expect(toolGroups.length).toBe(1);
    const tg = toolGroups[0]!;
    if (tg.kind !== 'tool-group') throw new Error('narrow');
    expect(tg.children.length).toBe(1);
    expect(tg.children[0]!.fileEditAdditions).toBeUndefined();
    expect(tg.children[0]!.fileEditDeletions).toBeUndefined();
    expect(tg.children[0]!.result?.ok).toBe(false);
  });

  it('aggregates two successful edits to the same file into one tool-group', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      fileEdit('src/foo.ts', 4, 5, 0),
      editToolCall('c2', 'src/foo.ts', 5),
      editToolResult('c2', 'src/foo.ts', 6),
      fileEdit('src/foo.ts', 7, 2, 3)
    ];
    const rows = deriveRows(events);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    expect(toolGroups.length).toBe(1);
    const tg = toolGroups[0]!;
    if (tg.kind !== 'tool-group') throw new Error('narrow');
    expect(tg.children.length).toBe(2);
    expect(tg.children[0]!.fileEditAdditions).toBe(5);
    expect(tg.children[0]!.fileEditDeletions).toBe(0);
    expect(tg.children[1]!.fileEditAdditions).toBe(2);
    expect(tg.children[1]!.fileEditDeletions).toBe(3);
  });

  it('does NOT fold a bare file-edit when no edit tool-group precedes it', () => {
    // Simulates a (hypothetical) bash mutation path or any future
    // emit path that surfaces a `file-edit` event without a matching
    // `edit` tool call. The legacy `file-edit-group` row must still
    // emit — we only fold when the prior row is an edit tool-group
    // with a successful matching child.
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      fileEdit('src/foo.ts', 2, 1, 1)
    ];
    const rows = deriveRows(events);
    const fileEditGroups = rows.filter((r) => r.kind === 'file-edit-group');
    expect(fileEditGroups.length).toBe(1);
  });

  it('does NOT fold when the file-edit path differs from the prior edit', () => {
    // Defense against a future provider that misorders events: the
    // fold only fires when the path matches the LAST settled edit
    // child. A mismatch must fall back to the file-edit-group path.
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      fileEdit('src/bar.ts', 4, 1, 1) // different path
    ];
    const rows = deriveRows(events);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    const fileEditGroups = rows.filter((r) => r.kind === 'file-edit-group');
    expect(toolGroups.length).toBe(1);
    expect(fileEditGroups.length).toBe(1);
  });
});
