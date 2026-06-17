import { describe, expect, it, vi } from 'vitest';
import { PhaseEngine } from '../../../../src/main/orchestrator/phased/phaseEngine.js';
import { DEFAULT_PHASED_EXECUTION_SETTINGS } from '../../../../src/shared/settings/phasedExecutionSettings.js';

vi.mock('../../../../src/main/orchestrator/phased/checkpointMarker.js', () => ({
  recordCheckpointMarker: vi.fn(async () => ({
    checkpointId: 'cp1',
    lastEntryId: '',
    entryCount: 0
  })),
  revertEntriesAfterMarker: vi.fn(async () => ({ ok: true, reverted: 0 }))
}));

vi.mock('../../../../src/main/orchestrator/phased/verifyRunner.js', () => ({
  runAcceptanceCommands: vi.fn(async () => ({
    evidence: [{ command: 'npm test', exitCode: 0, output: 'ok', timedOut: false }],
    allPassed: true,
    blocked: false
  }))
}));

describe('PhaseEngine', () => {
  it('advances intake → understand on valid phase_gate', async () => {
    const events: unknown[] = [];
    const engine = new PhaseEngine({
      runId: 'run1',
      workspaceId: 'ws1',
      workspacePath: '/tmp/ws',
      prompt: 'implement a multi-step refactor across the codebase',
      settings: { ...DEFAULT_PHASED_EXECUTION_SETTINGS, mode: 'always' },
      emit: (e) => events.push(e)
    });
    expect(engine.active).toBe(true);
    expect(engine.currentPhase).toBe('intake');

    const r = await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'intake',
      artifact: {
        phase: 'intake',
        goalRestatement: 'Refactor module',
        doneCriteria: [{ id: 'c1', description: 'Module tests pass' }],
        acceptanceCommands: ['npm test']
      }
    });
    expect(r.kind).toBe('advanced');
    expect(engine.currentPhase).toBe('understand');
    expect(events.some((e) => (e as { kind?: string }).kind === 'phase-gate')).toBe(true);
  });

  it('loops back from verify when host tests fail', async () => {
    const { runAcceptanceCommands } = await import(
      '../../../../src/main/orchestrator/phased/verifyRunner.js'
    );
    vi.mocked(runAcceptanceCommands).mockResolvedValueOnce({
      evidence: [{ command: 'npm test', exitCode: 1, output: 'fail', timedOut: false }],
      allPassed: false,
      blocked: false
    });

    const engine = new PhaseEngine({
      runId: 'run2',
      workspaceId: 'ws1',
      workspacePath: '/tmp/ws',
      prompt: 'implement feature',
      settings: { ...DEFAULT_PHASED_EXECUTION_SETTINGS, mode: 'always' },
      emit: () => {}
    });
    engine.acceptanceCommands = ['npm test'];
    engine.currentPhase = 'verify';

    await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'verify',
      artifact: {
        phase: 'verify',
        validationNotes: 'checked requirements',
        supplementalChecksPass: true
      }
    });

    const r = await engine.runPendingVerifyIfNeeded();
    expect(r?.kind).toBe('looped_back');
    expect(engine.currentPhase).toBe('diagnose');
  });
});
