/**
 * Regression tests for sub-agent visibility when spawn events are missing.
 *
 * `deriveRows` synthesizes `subagent-line` rows on first sub-agent-scoped
 * event and closes orchestrator-level tool groups at the boundary.
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
  it('emits subagent-line for sub-agent tool-call without spawn', () => {
    const rows = deriveRows([USER_PROMPT, TOOL_CALL_EDIT_A1]);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });

  it('emits subagent-line for sub-agent tool-result without spawn', () => {
    const rows = deriveRows([USER_PROMPT, TOOL_RESULT_EDIT_A1]);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });

  it('emits subagent-line for sub-agent file-edit without spawn', () => {
    const rows = deriveRows([USER_PROMPT, FILE_EDIT_A1]);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });

  it('produces inline subagent tool and file-edit rows for full run without spawn', () => {
    const rows = deriveRows([
      USER_PROMPT,
      TOOL_CALL_EDIT_A1,
      TOOL_RESULT_EDIT_A1,
      FILE_EDIT_A1
    ]);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    expect(toolGroups).toHaveLength(1);
    expect(toolGroups[0]).toMatchObject({ subagentId: 'A1' });
    expect(rows.filter((r) => r.kind === 'file-edit-group')).toHaveLength(0);
    const tg = toolGroups[0];
    if (tg?.kind === 'tool-group') {
      expect(tg.children[0]?.fileEditAdditions).toBeDefined();
    }
  });

  it('emits one subagent-line when spawn IS present', () => {
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

  it('closes orchestrator tool-groups on sub-agent boundary and emits inline subagent tool row', () => {
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
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    expect(toolGroups).toHaveLength(3);
    expect(toolGroups.some((g) => g.subagentId === 'A1')).toBe(true);
    expect(rows.filter((r) => r.kind === 'subagent-line')).toHaveLength(1);
  });

  it('rebuilt-from-transcript snapshot has the worker for DelegationWorker render', () => {
    const rebuilt = rebuildTimelineState([
      USER_PROMPT,
      TOOL_CALL_EDIT_A1,
      TOOL_RESULT_EDIT_A1,
      FILE_EDIT_A1
    ]);
    expect(rebuilt.subagents['A1']).toBeTruthy();
    expect(rebuilt.subagents['A1']?.status).toBe('running');
    expect(rebuilt.subagents['A1']?.fileEdits).toHaveLength(1);
    expect(rebuilt.subagents['A1']?.steps).toHaveLength(1);
  });
});
