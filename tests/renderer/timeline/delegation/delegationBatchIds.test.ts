import { describe, expect, it } from 'vitest';
import {
  isDelegationBatchSettled,
  isWorkerCardVisible,
  subagentIdsForDelegationBatch
} from '@renderer/components/timeline/delegation/delegationBatchIds.js';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types.js';

function snap(
  id: string,
  status: SubAgentSnapshot['status'],
  batchId?: string
): SubAgentSnapshot {
  return {
    id,
    task: 't',
    files: [],
    missingFiles: [],
    tools: [],
    unknownTools: [],
    status,
    startedAt: id === 'b' ? 2 : 1,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    ...(batchId ? { delegationBatchId: batchId } : {})
  };
}

describe('delegationBatchIds', () => {
  it('lists unique ids for a delegation batch in start order', () => {
    const subagents = {
      a: snap('a', 'queued', 'batch-1'),
      b: snap('b', 'running', 'batch-1'),
      c: snap('c', 'done', 'other')
    };
    expect(subagentIdsForDelegationBatch('batch-1', subagents)).toEqual(['a', 'b']);
  });

  it('hides queued workers from per-card timeline', () => {
    const subagents = { w: snap('w', 'queued') };
    expect(isWorkerCardVisible(subagents, 'w', true)).toBe(false);
    expect(isWorkerCardVisible({ w: snap('w', 'pending') }, 'w', false)).toBe(true);
    expect(isWorkerCardVisible({ w: snap('w', 'done') }, 'w', false)).toBe(false);
    expect(isWorkerCardVisible({ w: snap('w', 'done') }, 'w', true)).toBe(true);
  });

  it('detects settled batch', () => {
    const subagents = {
      a: snap('a', 'done', 'b1'),
      b: snap('b', 'failed', 'b1')
    };
    expect(isDelegationBatchSettled(['a', 'b'], subagents)).toBe(true);
    expect(isDelegationBatchSettled(['a', 'b', 'c'], { ...subagents, c: snap('c', 'running', 'b1') })).toBe(
      false
    );
  });
});
