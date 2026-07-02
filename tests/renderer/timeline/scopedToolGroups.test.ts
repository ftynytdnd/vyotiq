import { describe, expect, it } from 'vitest';
import type { Row } from '@renderer/components/timeline/reducer/deriveRows.js';
import {
  foldOrchestratorFileEdit,
  foldScopedFileEdit,
  foldToolCall,
  foldToolResult,
  type ScopedGroupState
} from '@renderer/components/timeline/reducer/deriveRows/scopedToolGroups.js';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';

function emptyState(): ScopedGroupState {
  return {
    openToolGroupIdx: null,
    callIdToGroupIdx: new Map(),
    callIdToChildIdx: new Map()
  };
}

describe('scopedToolGroups', () => {
  it('folds consecutive orchestrator tool calls into one group', () => {
    const out: Row[] = [];
    const state = emptyState();
    const callA: ToolCall = { id: 'c1', name: 'read', args: { path: 'a.ts' } };
    const callB: ToolCall = { id: 'c2', name: 'read', args: { path: 'b.ts' } };
    foldToolCall(out, state, callA);
    foldToolCall(out, state, callB);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('tool-group');
    if (out[0]?.kind === 'tool-group') {
      expect(out[0].children).toHaveLength(2);
    }
  });

  it('patches tool-result onto an existing call child', () => {
    const out: Row[] = [];
    const state = emptyState();
    const call: ToolCall = { id: 'c1', name: 'read', args: { path: 'a.ts' } };
    const result: ToolResult = {
      id: 'c1',
      name: 'read',
      ok: true,
      data: { tool: 'read', path: 'a.ts', content: '' }
    };
    foldToolCall(out, state, call);
    foldToolResult(out, state, result);
    if (out[0]?.kind === 'tool-group') {
      expect(out[0].children[0]?.result).toEqual(result);
    }
  });

  it('merges orchestrator file-edit into prior edit tool-group when path matches', () => {
    const out: Row[] = [];
    const state = emptyState();
    const call: ToolCall = { id: 'c1', name: 'edit', args: { path: 'x.ts' } };
    const result: ToolResult = {
      id: 'c1',
      name: 'edit',
      ok: true,
      data: { tool: 'edit', filePath: 'x.ts', additions: 1, deletions: 0 }
    };
    foldToolCall(out, state, call);
    foldToolResult(out, state, result);
    const merged = foldOrchestratorFileEdit(out, state, {
      id: 'fe1',
      filePath: 'x.ts',
      additions: 2,
      deletions: 1
    });
    expect(merged).toBe(true);
    expect(out.some((r) => r.kind === 'file-edit-group')).toBe(false);
  });

  it('emits bare file edits as inline settled cards', () => {
    const out: Row[] = [];
    const state = emptyState();
    foldScopedFileEdit(out, state, {
      id: 'fe1',
      filePath: 'a.ts',
      additions: 1,
      deletions: 0
    });
    foldScopedFileEdit(out, state, {
      id: 'fe2',
      filePath: 'b.ts',
      additions: 0,
      deletions: 1
    });
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.kind === 'file-edit-card')).toBe(true);
  });
});
