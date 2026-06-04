/**
 * SubAgentPool — concurrency cap and abort while workers are queued.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_DELEGATE_CONCURRENCY, SUBAGENT_RUN_TIMEOUT_MS } from '@shared/constants';

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
  permissions: {},
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
  it(`uses at most DEFAULT_DELEGATE_CONCURRENCY (${DEFAULT_DELEGATE_CONCURRENCY}) concurrent workers`, async () => {
    const specCount = DEFAULT_DELEGATE_CONCURRENCY + 4;
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
    expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_DELEGATE_CONCURRENCY);
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

  it('honors dynamic concurrency param over default cap', async () => {
    let maxInFlight = 0;
    let inFlight = 0;

    vi.mocked(runSubAgent).mockImplementation(async (s) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return {
        id: s.id,
        task: s.task,
        output: '',
        toolResults: [],
        inlinedFileCount: 0,
        status: 'success' as const
      };
    });

    const specs = Array.from({ length: 6 }, (_, i) => spec(`D${i}`));
    await runSubAgentPool(specs, { ...baseDeps, concurrency: 2 });
    expect(maxInFlight).toBe(2);
  });

  it('fails a worker when the pool run exceeds SUBAGENT_RUN_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(runSubAgent).mockImplementation(
        () =>
          new Promise(() => {
            /* never settles */
          })
      );

      const poolPromise = runSubAgentPool([spec('slow')], baseDeps);
      await vi.advanceTimersByTimeAsync(SUBAGENT_RUN_TIMEOUT_MS);

      const runs = await poolPromise;
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('failed');
      expect(runs[0]?.error).toMatch(/run timed out/i);
      expect(runs[0]?.error).toContain(
        String(Math.round(SUBAGENT_RUN_TIMEOUT_MS / 1000))
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
