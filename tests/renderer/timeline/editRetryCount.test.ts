/**
 * Edit retry count folding in tool groups.
 */

import { describe, expect, it } from 'vitest';
import type { ToolResult } from '@shared/types/tool';
import { foldToolCall, foldToolResult, type ScopedGroupState } from '@renderer/components/timeline/reducer/deriveRows/scopedToolGroups';
import type { Row } from '@renderer/components/timeline/reducer/deriveRows';

function freshState(): ScopedGroupState {
  return {
    openToolGroupIdx: null,
    callIdToGroupIdx: new Map(),
    callIdToChildIdx: new Map()
  };
}

function failedEditResult(id: string, path: string): ToolResult {
  return {
    id,
    name: 'edit',
    ok: false,
    output: 'no match',
    error: 'no match',
    durationMs: 1
  };
}

describe('scopedToolGroups — edit retryCount', () => {
  it('increments retryCount for consecutive failed edits on the same path', () => {
    const out: Row[] = [];
    const state = freshState();

    foldToolCall(out, state, {
      id: 'c1',
      name: 'edit',
      args: { path: 'src/Hero.tsx', oldString: 'a', newString: 'b' }
    });
    foldToolResult(out, state, failedEditResult('c1', 'src/Hero.tsx'));

    foldToolCall(out, state, {
      id: 'c2',
      name: 'edit',
      args: { path: 'src/Hero.tsx', oldString: 'c', newString: 'd' }
    });
    foldToolResult(out, state, failedEditResult('c2', 'src/Hero.tsx'));

    const group = out[0];
    expect(group?.kind).toBe('tool-group');
    if (group?.kind !== 'tool-group') return;
    expect(group.children[1]?.retryCount).toBe(2);
  });
});
