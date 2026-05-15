/**
 * Regression tests for `deriveRows`'s sub-agent visibility fail-soft.
 *
 * Background — the "Nothing between text and panel" symptom:
 *   A user observed a turn where the assistant text streamed, then
 *   `done in 30s` rendered, then the PendingChangesPanel showed three
 *   `Created X.ext` rows — but the timeline had NO sub-agent row,
 *   NO orchestrator-level tool row, and NO file-edit row between the
 *   assistant text and the panel. Files had been created on disk
 *   (checkpoint registry populated) but the worker that created them
 *   was invisible.
 *
 * Root cause: `deriveRows` only emitted a `subagent-line` from the
 *   `subagent-pending` / `subagent-spawn` branch. Every sub-agent-
 *   scoped `tool-call` / `tool-result` / `file-edit` was a
 *   `if (e.subagentId) break;` no-op (skip top-level rendering;
 *   `SubAgentTrace` is supposed to surface it). When either of those
 *   row-opening events was missing — lost in IPC, dropped by the
 *   reducer's `subagent-pending` no-op when an auto-created `running`
 *   snapshot from a tool-event arrived first, persisted without the
 *   matching spawn on a crash, etc. — the worker's entire activity
 *   was invisible to the user even though the snapshot existed in
 *   `state.subagents` (created by `applyTimelineEvent`'s
 *   `ensureSnapshot`).
 *
 * Fix: `deriveRows` now opens the `subagent-line` row the FIRST time
 *   ANY sub-agent-scoped event for a given id is observed — spawn,
 *   pending, tool-call, tool-result, or file-edit. Dedup is shared
 *   across the cases so the authoritative spawn/pending case still
 *   produces exactly one row when present (no regression of the
 *   existing `subagent-line dedup` test).
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { rebuildTimelineState } from '@renderer/components/timeline/reducer/applyTimelineEvent';

const USER_PROMPT: TimelineEvent = {
  kind: 'user-prompt',
  id: 'u1',
  ts: 0,
  content: 'create random files'
};

const TOOL_CALL_EDIT_A1: TimelineEvent = {
  kind: 'tool-call',
  id: 'tc1',
  ts: 1000,
  subagentId: 'A1',
  call: {
    id: 'call-edit-1',
    name: 'edit',
    args: { path: 'test_note.txt', create: true, content: 'hello' }
  }
};

const TOOL_RESULT_EDIT_A1: TimelineEvent = {
  kind: 'tool-result',
  id: 'tr1',
  ts: 1100,
  subagentId: 'A1',
  result: {
    id: 'call-edit-1',
    name: 'edit',
    ok: true,
    output: 'Created test_note.txt (+1 lines).',
    data: {
      tool: 'edit',
      filePath: 'test_note.txt',
      additions: 1,
      deletions: 0,
      created: true,
      createdContent: 'hello'
    },
    durationMs: 50
  }
};

const FILE_EDIT_A1: TimelineEvent = {
  kind: 'file-edit',
  id: 'fe1',
  ts: 1100,
  subagentId: 'A1',
  filePath: 'test_note.txt',
  additions: 1,
  deletions: 0
};

describe('deriveRows — sub-agent visibility fail-soft', () => {
  it('emits a subagent-line for a tool-call whose spawn event is missing', () => {
    const rows = deriveRows([USER_PROMPT, TOOL_CALL_EDIT_A1]);
    const lines = rows.filter((r) => r.kind === 'subagent-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'subagent-line', subagentId: 'A1' });
  });

  it('emits a subagent-line for a tool-result whose spawn event is missing', () => {
    const rows = deriveRows([USER_PROMPT, TOOL_RESULT_EDIT_A1]);
    const lines = rows.filter((r) => r.kind === 'subagent-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'subagent-line', subagentId: 'A1' });
  });

  it('emits a subagent-line for a file-edit whose spawn event is missing', () => {
    const rows = deriveRows([USER_PROMPT, FILE_EDIT_A1]);
    const lines = rows.filter((r) => r.kind === 'subagent-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'subagent-line', subagentId: 'A1' });
  });

  it('emits EXACTLY ONE subagent-line for a full nested run without spawn', () => {
    // The "Nothing between text and panel" repro: tool-call → tool-result
    // → file-edit, all tagged with subagentId, but no preceding
    // `subagent-spawn` or `subagent-pending`. Pre-fix this produced
    // zero rows; post-fix it produces exactly one `subagent-line`
    // row and no top-level orchestrator tool-group rows.
    const rows = deriveRows([
      USER_PROMPT,
      TOOL_CALL_EDIT_A1,
      TOOL_RESULT_EDIT_A1,
      FILE_EDIT_A1
    ]);
    const subagentLines = rows.filter((r) => r.kind === 'subagent-line');
    expect(subagentLines).toHaveLength(1);
    expect(subagentLines[0]).toMatchObject({ kind: 'subagent-line', subagentId: 'A1' });
    // The nested tool events MUST NOT produce top-level orchestrator
    // tool-group / file-edit-group rows — they belong inside the
    // `SubAgentTrace` rendered from the synthetic `subagent-line`.
    expect(rows.filter((r) => r.kind === 'tool-group')).toHaveLength(0);
    expect(rows.filter((r) => r.kind === 'file-edit-group')).toHaveLength(0);
  });

  it('still emits exactly one subagent-line when spawn IS present (no regression)', () => {
    const rows = deriveRows([
      USER_PROMPT,
      {
        kind: 'subagent-spawn',
        id: 'sp1',
        ts: 500,
        subagentId: 'A1',
        task: 'create files',
        files: [],
        tools: ['edit']
      },
      TOOL_CALL_EDIT_A1,
      TOOL_RESULT_EDIT_A1,
      FILE_EDIT_A1
    ]);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });

  it('opens separate subagent-line rows for distinct worker ids', () => {
    // Parallel workers — A1 has a spawn event, A2 does not. Both
    // should produce a single row each, in the order their first
    // event appears.
    const rows = deriveRows([
      USER_PROMPT,
      {
        kind: 'subagent-spawn',
        id: 'sp1',
        ts: 100,
        subagentId: 'A1',
        task: 'A1 task',
        files: [],
        tools: []
      },
      {
        ...TOOL_CALL_EDIT_A1,
        id: 'tc-A2',
        subagentId: 'A2',
        call: { ...TOOL_CALL_EDIT_A1.call, id: 'call-A2-1' }
      } as TimelineEvent,
      TOOL_CALL_EDIT_A1
    ]);
    const lines = rows.filter((r) => r.kind === 'subagent-line');
    expect(lines).toHaveLength(2);
    // Order: A1 (spawn @100) before A2 (first tool-call @1000).
    expect(lines.map((r) => (r as { subagentId: string }).subagentId)).toEqual([
      'A1',
      'A2'
    ]);
  });

  it('closes any open orchestrator-level tool-group before synthesising the sub-agent row', () => {
    // An orchestrator `ls` call streams in first → opens a top-level
    // tool-group. THEN a sub-agent-scoped tool-call arrives without a
    // preceding spawn. The synthesised `subagent-line` must close the
    // tool-group (mirroring the authoritative spawn/pending branch)
    // so subsequent orchestrator-level calls start a fresh group
    // rather than smuggling the sub-agent's activity into the open
    // orchestrator-level row visually.
    const rows = deriveRows([
      USER_PROMPT,
      {
        kind: 'tool-call',
        id: 'tc-ls',
        ts: 50,
        call: { id: 'orc-ls-1', name: 'ls', args: { path: '.' } }
      },
      TOOL_CALL_EDIT_A1,
      {
        kind: 'tool-call',
        id: 'tc-ls-2',
        ts: 1200,
        call: { id: 'orc-ls-2', name: 'ls', args: { path: 'src' } }
      }
    ]);
    // The orchestrator-level ls calls land in TWO separate tool-groups
    // because the sub-agent line breaks the run — exactly like a real
    // `subagent-spawn` would have. Both groups are toolName='ls' with
    // one child each.
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    expect(toolGroups).toHaveLength(2);
    expect(toolGroups[0]).toMatchObject({ toolName: 'ls' });
    expect(toolGroups[1]).toMatchObject({ toolName: 'ls' });
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });

  it('rebuilt-from-transcript snapshot also has the worker, so SubAgentTrace can render', () => {
    // The synthetic `subagent-line` is only useful if the matching
    // `subagent` snapshot exists in `state.subagents` — otherwise
    // `SubAgentTrace`'s `if (!snap) return null;` would render
    // nothing. Verify `applyTimelineEvent`'s `ensureSnapshot` path
    // populates the snapshot from any sub-agent-scoped event, so the
    // pair (synthetic row + auto-created snapshot) gives the user
    // visible feedback even when the spawn was lost.
    const rebuilt = rebuildTimelineState([
      USER_PROMPT,
      TOOL_CALL_EDIT_A1,
      TOOL_RESULT_EDIT_A1,
      FILE_EDIT_A1
    ]);
    expect(rebuilt.subagents['A1']).toBeTruthy();
    expect(rebuilt.subagents['A1']?.status).toBe('running');
    // The file-edit was folded into the snapshot.
    expect(rebuilt.subagents['A1']?.fileEdits).toHaveLength(1);
    expect(rebuilt.subagents['A1']?.fileEdits[0]).toMatchObject({
      filePath: 'test_note.txt',
      additions: 1,
      deletions: 0
    });
    // And the tool round is in `steps`.
    expect(rebuilt.subagents['A1']?.steps).toHaveLength(1);
    expect(rebuilt.subagents['A1']?.steps[0]?.call?.name).toBe('edit');
  });
});
