/**
 * SubAgentPool — concurrency cap and abort while workers are queued.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MAX_PARALLEL_SUBAGENTS } from '@shared/constants';

vi.mock('@main/orchestrator/SubAgent.js', () => ({
  runSubAgent: vi.fn()
}));

import { runSubAgent } from '@main/orchestrator/SubAgent.js';
import { runSubAgentPool } from '@main/orchestrator/SubAgentPool.js';

const baseDeps = {
  selection: { providerId: 'p', modelId: 'm' },
  workspacePath: 'C:/tmp/ws',
  workspaceId: 'ws-test',
  runId: 'run-test',
  conversationId: 'conv-test',
  strictApprovals: false,
  permissions: { allowAuto: false },
  signal: new AbortController().signal
};

function spec(id: string) {
  return { id, task: `task-${id}`, files: [], tools: ['read'] };
}

beforeEach(() => {
  vi.mocked(runSubAgent).mockReset();
  vi.mocked(runSubAgent).mockImplementation(async (s) => ({
    id: s.id,
    task: s.task,
    output: '',
    toolResults: [],
    inlinedFileCount: 0,
    status: 'success' as const
  }));
});

describe('runSubAgentPool', () => {
  it(`uses at most MAX_PARALLEL_SUBAGENTS (${MAX_PARALLEL_SUBAGENTS}) concurrent workers`, async () => {
    const specCount = MAX_PARALLEL_SUBAGENTS + 4;
    let inFlight = 0;
    let maxInFlight = 0;

    vi.mocked(runSubAgent).mockImplementation(async (s) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight -= 1;
      return {
        id: s.id,
        task: s.task,
        output: '',
        toolResults: [],
        inlinedFileCount: 0,
        status: 'success'
      };
    });

    const specs = Array.from({ length: specCount }, (_, i) => spec(`S${i}`));
    const runs = await runSubAgentPool(specs, baseDeps);
    expect(runs).toHaveLength(specCount);
    expect(maxInFlight).toBeLessThanOrEqual(MAX_PARALLEL_SUBAGENTS);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('does not start queued workers after the pool signal aborts', async () => {
    const controller = new AbortController();
    const started: string[] = [];

    vi.mocked(runSubAgent).mockImplementation(async (s) => {
      started.push(s.id);
      await new Promise((r) => setTimeout(r, 80));
      return {
        id: s.id,
        task: s.task,
        output: '',
        toolResults: [],
        inlinedFileCount: 0,
        status: 'aborted'
      };
    });

    const specs = [spec('A'), spec('B'), spec('C')];
    const poolPromise = runSubAgentPool(specs, {
      ...baseDeps,
      concurrency: 1,
      signal: controller.signal
    });

    await new Promise((r) => setTimeout(r, 15));
    controller.abort();

    const runs = await poolPromise;
    expect(runs).toHaveLength(3);
    expect(started).toEqual(['A']);
    for (const run of runs) {
      expect(run).toBeDefined();
      expect(run.id).toBeTruthy();
      expect(run.status).toBeTruthy();
    }
    expect(runs[1]?.status).toBe('aborted');
    expect(runs[2]?.status).toBe('aborted');
    expect(runs[1]?.output).toBe('');
    expect(runs[2]?.output).toBe('');
  });
});
