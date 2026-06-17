import { describe, expect, it, vi } from 'vitest';
import {
  applyPhasedEscapeResolution,
  readPhasedEscapeAction
} from '../../../../src/main/orchestrator/phased/phasedEscapeResolve.js';
import type { PersistedPhaseEngineState } from '../../../../src/shared/types/phased.js';
import { MAX_TOTAL_ITERATIONS } from '../../../../src/shared/constants.js';

const revertMock = vi.fn(async () => ({ ok: true as const, reverted: 2 }));
vi.mock('../../../../src/main/orchestrator/phased/checkpointMarker.js', () => ({
  revertEntriesAfterMarker: (...args: unknown[]) => revertMock(...(args as [])),
  recordCheckpointMarker: vi.fn()
}));

function baseSnapshot(): PersistedPhaseEngineState {
  return {
    active: true,
    mode: 'always',
    runId: 'run1',
    seq: 10,
    subtasks: [{ subtaskId: 's1', description: 'root', currentPhase: 'execute', isRoot: true }],
    activeSubtaskId: 's1',
    currentPhase: 'execute',
    doneCriteria: [{ id: 'c1', description: 'done' }],
    acceptanceCommands: ['npm test'],
    planSteps: [],
    checkpointMarker: { checkpointId: 'cp1', lastEntryId: 'e9', entryCount: 3 },
    verifyEvidence: null,
    guards: {
      phaseCyclesUsed: 8,
      phaseCycleCap: 8,
      globalIteration: 12,
      globalIterationCap: 24,
      lastFailureSignature: 'verify|test_failure|boom',
      repeatFailureCount: 2
    },
    ledgerEntryIds: ['l1', 'l2']
  };
}

describe('readPhasedEscapeAction', () => {
  it('reads the selected option id', () => {
    expect(
      readPhasedEscapeAction([{ questionId: 'escape_action', selectedOptionIds: ['rollback'] }])
    ).toBe('rollback');
  });

  it('defaults to supply_info when no option chosen', () => {
    expect(readPhasedEscapeAction([{ questionId: 'escape_action', freeText: 'try X' }])).toBe(
      'supply_info'
    );
  });
});

describe('applyPhasedEscapeResolution', () => {
  it('aborts without touching the snapshot', async () => {
    const r = await applyPhasedEscapeResolution({
      snapshot: baseSnapshot(),
      action: 'abort',
      workspaceId: 'ws',
      runId: 'run1'
    });
    expect(r.kind).toBe('abort');
  });

  it('clears guards on approve_approach', async () => {
    const r = await applyPhasedEscapeResolution({
      snapshot: baseSnapshot(),
      action: 'approve_approach',
      workspaceId: 'ws',
      runId: 'run1'
    });
    expect(r.kind).toBe('resume');
    if (r.kind !== 'resume') return;
    expect(r.snapshot.guards.repeatFailureCount).toBe(0);
    expect(r.snapshot.guards.phaseCyclesUsed).toBe(0);
    expect(r.snapshot.guards.lastFailureSignature).toBeNull();
    expect(r.snapshot.currentPhase).toBe('execute');
  });

  it('reverts checkpoint and resumes at execute on rollback', async () => {
    revertMock.mockClear();
    const r = await applyPhasedEscapeResolution({
      snapshot: baseSnapshot(),
      action: 'rollback',
      workspaceId: 'ws',
      runId: 'run1'
    });
    expect(revertMock).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('resume');
    if (r.kind !== 'resume') return;
    expect(r.snapshot.currentPhase).toBe('execute');
    expect(r.snapshot.checkpointMarker).toBeNull();
    expect(r.snapshot.subtasks[0]?.currentPhase).toBe('execute');
  });

  it('lifts the soft global cap (within the hard ceiling) only on a global-cap trip', async () => {
    const snap = baseSnapshot();
    snap.guards.globalIterationCap = 12;
    snap.guards.globalIteration = 12;
    const supply = await applyPhasedEscapeResolution({
      snapshot: snap,
      action: 'supply_info',
      trip: 'global_iteration_cap',
      workspaceId: 'ws',
      runId: 'run1'
    });
    expect(supply.kind).toBe('resume');
    if (supply.kind === 'resume') {
      expect(supply.snapshot.guards.globalIterationCap).toBeGreaterThan(12);
      expect(supply.snapshot.guards.globalIterationCap).toBeLessThanOrEqual(MAX_TOTAL_ITERATIONS);
    }

    const noProgress = await applyPhasedEscapeResolution({
      snapshot: baseSnapshot(),
      action: 'supply_info',
      trip: 'no_progress',
      workspaceId: 'ws',
      runId: 'run1'
    });
    expect(noProgress.kind === 'resume' && noProgress.snapshot.guards.globalIterationCap === 24).toBe(
      true
    );
  });

  it('does not mutate the original snapshot', async () => {
    const snap = baseSnapshot();
    await applyPhasedEscapeResolution({
      snapshot: snap,
      action: 'approve_approach',
      workspaceId: 'ws',
      runId: 'run1'
    });
    expect(snap.guards.repeatFailureCount).toBe(2);
  });
});
