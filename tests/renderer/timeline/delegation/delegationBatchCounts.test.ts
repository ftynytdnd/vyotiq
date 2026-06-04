import { describe, expect, it } from 'vitest';
import {
  countDelegationBatch,
  formatDelegationBatchLabel
} from '@renderer/components/timeline/delegation/delegationBatchCounts.js';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types.js';

function snap(status: SubAgentSnapshot['status']): SubAgentSnapshot {
  return {
    id: 'w1',
    task: 't',
    files: [],
    missingFiles: [],
    tools: [],
    unknownTools: [],
    status,
    startedAt: 0,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {}
  };
}

describe('delegationBatchCounts', () => {
  it('dedupes duplicate subagent ids in batch totals', () => {
    const subagents = {
      a: snap('running'),
      b: snap('queued')
    };
    const counts = countDelegationBatch(['a', 'a', 'b', 'b'], subagents);
    expect(counts.total).toBe(2);
    expect(formatDelegationBatchLabel(counts)).toBe(
      '2 workers · 1 running · 1 queued'
    );
  });

  it('formats running and queued', () => {
    const subagents = {
      a: snap('running'),
      b: snap('running'),
      c: snap('queued'),
      d: snap('queued')
    };
    const counts = countDelegationBatch(['a', 'b', 'c', 'd'], subagents);
    expect(formatDelegationBatchLabel(counts)).toBe(
      '4 workers · 2 running · 2 queued'
    );
  });
});
