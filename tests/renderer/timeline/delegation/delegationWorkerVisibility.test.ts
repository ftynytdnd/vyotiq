import { describe, expect, it } from 'vitest';
import {
  delegationBatchHasLiveWorkers,
  isWorkerCardVisible
} from '@renderer/components/timeline/delegation/delegationBatchIds.js';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types.js';

function snap(status: SubAgentSnapshot['status']): SubAgentSnapshot {
  return {
    id: 'w',
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

describe('delegation worker visibility', () => {
  it('hides queued workers from per-worker rows', () => {
    const subagents = { w: snap('queued') };
    expect(isWorkerCardVisible(subagents, 'w', true)).toBe(false);
    expect(isWorkerCardVisible(subagents, 'w', false)).toBe(false);
  });

  it('always shows pending and running workers', () => {
    expect(isWorkerCardVisible({ w: snap('pending') }, 'w', false)).toBe(true);
    expect(isWorkerCardVisible({ w: snap('running') }, 'w', false)).toBe(true);
  });

  it('shows settled workers only when the batch is expanded', () => {
    expect(isWorkerCardVisible({ w: snap('done') }, 'w', false)).toBe(false);
    expect(isWorkerCardVisible({ w: snap('done') }, 'w', true)).toBe(true);
    expect(isWorkerCardVisible({ w: snap('failed') }, 'w', true)).toBe(true);
  });

  it('detects live batches', () => {
    const subagents = {
      a: snap('queued'),
      b: snap('done')
    };
    expect(delegationBatchHasLiveWorkers(['a', 'b'], subagents)).toBe(true);
    expect(delegationBatchHasLiveWorkers(['b'], { b: snap('done') })).toBe(false);
  });
});
