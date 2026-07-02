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
import { deriveDisplayRows, deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
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
  it('folds a successful edit + matching file-edit into one inline card row', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      fileEdit('src/foo.ts', 4, 3, 2)
    ];
    const rows = deriveDisplayRows(events);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    const cards = rows.filter((r) => r.kind === 'file-edit-card');
    expect(toolGroups.length).toBe(0);
    expect(cards.length).toBe(1);
    const card = cards[0]!;
    if (card.kind !== 'file-edit-card') throw new Error('narrow');
    expect(card.filePath).toBe('src/foo.ts');
    expect(card.additions).toBe(3);
    expect(card.deletions).toBe(2);
    expect(card.phase).toBe('settled');
  });

  it('keeps settled file-edit-card row when tool-result has empty hunks', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      fileEdit('src/foo.ts', 4, 3, 2)
    ];
    const rows = deriveDisplayRows(events);
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card?.kind).toBe('file-edit-card');
    if (card?.kind !== 'file-edit-card') throw new Error('narrow');
    expect(card.hunks).toBeUndefined();
    expect(card.additions).toBe(3);
  });

  it('keeps a failed edit as a single tool-group with no diff stats', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3, false)
      // no file-edit — the tool refused to write
    ];
    const rows = deriveDisplayRows(events);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    expect(toolGroups.length).toBe(1);
    const tg = toolGroups[0]!;
    if (tg.kind !== 'tool-group') throw new Error('narrow');
    expect(tg.children.length).toBe(1);
    expect(tg.children[0]!.fileEditAdditions).toBeUndefined();
    expect(tg.children[0]!.fileEditDeletions).toBeUndefined();
    expect(tg.children[0]!.result?.ok).toBe(false);
  });

  it('consolidates two successful edits to the same file into one inline card', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      fileEdit('src/foo.ts', 4, 5, 0),
      editToolCall('c2', 'src/foo.ts', 5),
      editToolResult('c2', 'src/foo.ts', 6),
      fileEdit('src/foo.ts', 7, 2, 3)
    ];
    const rows = deriveDisplayRows(events);
    const cards = rows.filter((r) => r.kind === 'file-edit-card');
    expect(cards.length).toBe(1);
    const card = cards[0]!;
    if (card.kind !== 'file-edit-card') throw new Error('narrow');
    expect(card.filePath).toBe('src/foo.ts');
    expect(card.additions).toBe(2);
    expect(card.deletions).toBe(3);
    expect(card.revisions?.length).toBe(1);
    expect(card.revisions?.[0]?.additions).toBe(5);
    expect(card.revisions?.[0]?.deletions).toBe(0);
  });

  it('does NOT fold a bare file-edit when no edit tool-group precedes it', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      fileEdit('src/foo.ts', 2, 1, 1)
    ];
    const rows = deriveDisplayRows(events);
    const cards = rows.filter((r) => r.kind === 'file-edit-card');
    expect(cards.length).toBe(1);
    if (cards[0]!.kind !== 'file-edit-card') throw new Error('narrow');
    expect(cards[0].filePath).toBe('src/foo.ts');
  });

  it('folds when assistant text closed the open tool group between result and file-edit', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      { kind: 'agent-text-delta', id: 'a1', ts: 4, delta: 'brief status' },
      { kind: 'agent-text-end', id: 'a1', ts: 5 },
      fileEdit('src/foo.ts', 6, 3, 2)
    ];
    const rows = deriveDisplayRows(events);
    expect(rows.filter((r) => r.kind === 'file-edit-card').length).toBeGreaterThan(0);
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card?.kind === 'file-edit-card' && card.additions).toBe(3);
  });

  it('does NOT fold when the file-edit path differs from the prior edit', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      editToolCall('c1', 'src/foo.ts', 2),
      editToolResult('c1', 'src/foo.ts', 3),
      fileEdit('src/bar.ts', 4, 1, 1)
    ];
    const rows = deriveDisplayRows(events);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    const cards = rows.filter((r) => r.kind === 'file-edit-card');
    expect(toolGroups.length).toBe(0);
    expect(cards.length).toBe(2);
    const paths = cards
      .filter((r): r is Extract<(typeof cards)[number], { kind: 'file-edit-card' }> => r.kind === 'file-edit-card')
      .map((r) => r.filePath)
      .sort();
    expect(paths).toEqual(['src/bar.ts', 'src/foo.ts']);
  });
});

describe('deriveRows — partial tool synthesis ordering', () => {
  it('appends synthesized partial tool rows at the turn tail during a live run', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      { kind: 'agent-text-delta', id: 'a1', ts: 2, delta: 'Answer first on wire.' },
      { kind: 'agent-text-end', id: 'a1', ts: 3 }
    ];
    const partials = {
      partial1: {
        callId: 'partial1',
        name: 'read',
        index: 0,
        argsBuf: '{"path":"src/a.ts"}',
        parsed: { path: 'src/a.ts' },
        ts: 4
      }
    };
    const rows = deriveDisplayRows(events, { partialToolCallArgs: partials, runActive: true });
    const kinds = rows.map((r) => r.kind);
    const assistantIdx = kinds.indexOf('assistant-text');
    const toolIdx = kinds.indexOf('tool-group');
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(assistantIdx);
  });

  it('keeps settled transcript rows in wire order (no activity-first reorder)', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      { kind: 'agent-text-delta', id: 'a1', ts: 2, delta: 'Answer first on wire.' },
      { kind: 'agent-text-end', id: 'a1', ts: 3 },
      { kind: 'tool-call', id: 'c1', ts: 4, call: { id: 'call-1', name: 'read', args: { path: 'a.ts' } } }
    ];
    const rows = deriveRows(events, { runActive: false });
    const kinds = rows.map((r) => r.kind);
    const assistantIdx = kinds.indexOf('assistant-text');
    const toolIdx = kinds.indexOf('tool-group');
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(assistantIdx);
  });
});
