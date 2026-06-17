import { describe, expect, it, vi } from 'vitest';
import { PhaseEngine } from '../../../../src/main/orchestrator/phased/phaseEngine.js';
import { reconstructPhaseEngineFromEvents } from '../../../../src/main/orchestrator/phased/reconstructFromTranscript.js';
import { DEFAULT_PHASED_EXECUTION_SETTINGS } from '../../../../src/shared/settings/phasedExecutionSettings.js';
import type { TimelineEvent } from '../../../../src/shared/types/chat.js';
import type { PhaseArtifact } from '../../../../src/shared/types/phased.js';

const recordMarkerMock = vi.fn(async () => ({
  checkpointId: 'cp1',
  lastEntryId: 'e1',
  entryCount: 1
}));
const revertMock = vi.fn(async () => ({ ok: true as const, reverted: 1 }));
vi.mock('../../../../src/main/orchestrator/phased/checkpointMarker.js', () => ({
  recordCheckpointMarker: (...a: unknown[]) => recordMarkerMock(...(a as [])),
  revertEntriesAfterMarker: (...a: unknown[]) => revertMock(...(a as []))
}));

const verifyMock = vi.fn(async () => ({
  evidence: [{ command: 'npm test', exitCode: 0, output: 'ok', timedOut: false }],
  allPassed: true,
  blocked: false
}));
vi.mock('../../../../src/main/orchestrator/phased/verifyRunner.js', () => ({
  runAcceptanceCommands: (...a: unknown[]) => verifyMock(...(a as []))
}));

function makeEngine(events: TimelineEvent[]): PhaseEngine {
  return new PhaseEngine({
    runId: 'run-e2e',
    workspaceId: 'ws',
    workspacePath: '/tmp/ws',
    prompt: 'implement a multi-step feature end to end',
    settings: { ...DEFAULT_PHASED_EXECUTION_SETTINGS, mode: 'always' },
    emit: (e) => events.push(e)
  });
}

function artifactFor(phase: PhaseArtifact['phase'], st: string): PhaseArtifact {
  switch (phase) {
    case 'intake':
      return {
        phase,
        goalRestatement: 'Build the feature',
        doneCriteria: [{ id: 'c1', description: 'Feature works and is tested' }],
        acceptanceCommands: ['npm test']
      };
    case 'understand':
      return {
        phase,
        facts: [{ statement: 'entry lives in foo.ts', codeLinks: [{ file: 'foo.ts', line: 10 }] }],
        openAmbiguities: []
      };
    case 'think_frame':
      return {
        phase,
        chosenApproach: 'extend the parser',
        rejectedAlternatives: [{ approach: 'rewrite', reason: 'too risky' }],
        hypotheses: ['parser is the bottleneck'],
        constraints: ['no new deps']
      };
    case 'plan':
      return {
        phase,
        steps: [
          {
            subtaskId: st,
            order: 1,
            description: 'add guard',
            doneCriterionId: 'c1',
            verificationMethod: 'npm test'
          }
        ]
      };
    case 'rethink':
      return {
        phase,
        riskiestAssumption: 'parser handles unicode',
        attackNotes: 'tested with emoji input',
        unaddressedHighRisks: []
      };
    case 'checkpoint':
      return { phase, ready: true };
    case 'execute':
      return {
        phase,
        incrementSummary: 'added guard',
        codeLinks: [{ file: 'foo.ts', line: 12 }],
        selfConsistent: true
      };
    case 'verify':
      return { phase, validationNotes: 'matches requirements', supplementalChecksPass: true };
    case 'reflect':
      return { phase, lessons: ['guard clauses matter'], remainingSteps: [] };
    case 'diagnose':
      throw new Error('use explicit diagnose artifact');
    default: {
      const _x: never = phase;
      return _x;
    }
  }
}

async function gate(engine: PhaseEngine, phase: PhaseArtifact['phase']) {
  return engine.handlePhaseGateArgs({
    subtaskId: engine.activeSubtaskId,
    phase,
    artifact: artifactFor(phase, engine.activeSubtaskId)
  });
}

describe('PhaseEngine end-to-end', () => {
  it('runs INTAKE → DONE on a clean path', async () => {
    verifyMock.mockClear();
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);

    expect((await gate(engine, 'intake')).kind).toBe('advanced');
    expect((await gate(engine, 'understand')).kind).toBe('advanced');
    expect((await gate(engine, 'think_frame')).kind).toBe('advanced');
    expect((await gate(engine, 'plan')).kind).toBe('advanced');
    expect((await gate(engine, 'rethink')).kind).toBe('advanced');
    expect((await gate(engine, 'checkpoint')).kind).toBe('advanced');
    expect(engine.currentPhase).toBe('execute');

    // EXECUTE pass triggers host VERIFY immediately.
    expect((await gate(engine, 'execute')).kind).toBe('verify_pending');
    const verified = await engine.runPendingVerifyIfNeeded();
    expect(verified?.kind).toBe('advanced');
    expect(engine.currentPhase).toBe('reflect');

    expect((await gate(engine, 'reflect')).kind).toBe('all_subtasks_done');
    expect(engine.currentPhase).toBe('done');
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it('forces a loop-back when host tests fail, then converges', async () => {
    verifyMock.mockClear();
    revertMock.mockClear();
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);

    for (const p of ['intake', 'understand', 'think_frame', 'plan', 'rethink', 'checkpoint'] as const) {
      await gate(engine, p);
    }
    await gate(engine, 'execute');

    // First verify fails → loop back to diagnose.
    verifyMock.mockResolvedValueOnce({
      evidence: [{ command: 'npm test', exitCode: 1, output: 'boom', timedOut: false }],
      allPassed: false,
      blocked: false
    });
    const failed = await engine.runPendingVerifyIfNeeded();
    expect(failed?.kind).toBe('looped_back');
    expect(engine.currentPhase).toBe('diagnose');

    // Diagnose cites a real ledger entry → routes to execute + rolls back.
    const realEntry = engine.ledgerEntryIds[engine.ledgerEntryIds.length - 1]!;
    const routed = await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'diagnose',
      artifact: {
        phase: 'diagnose',
        classification: 'bad_implementation',
        targetPhase: 'execute',
        evidence: 'guard was wrong',
        citeLedgerEntryId: realEntry
      }
    });
    expect(routed.kind).toBe('looped_back');
    expect(engine.currentPhase).toBe('execute');
    expect(revertMock).toHaveBeenCalledTimes(1);

    // Re-execute → verify passes → reflect → done.
    await gate(engine, 'execute');
    const ok = await engine.runPendingVerifyIfNeeded();
    expect(ok?.kind).toBe('advanced');
    expect((await gate(engine, 'reflect')).kind).toBe('all_subtasks_done');
    expect(engine.currentPhase).toBe('done');
  });

  it('blocks a diagnose loop-back that cites a non-existent ledger entry', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    engine.currentPhase = 'diagnose';
    engine.ledgerEntryIds = ['real-1'];

    const r = await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'diagnose',
      artifact: {
        phase: 'diagnose',
        classification: 'wrong_facts',
        targetPhase: 'understand',
        evidence: 'misread the code',
        citeLedgerEntryId: 'ghost'
      }
    });
    expect(r.kind).toBe('blocked');
    expect(engine.currentPhase).toBe('diagnose');
  });

  it('reconstructs exact engine state from the persisted ledger', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    for (const p of ['intake', 'understand', 'think_frame', 'plan'] as const) {
      await gate(engine, p);
    }

    const rebuilt = reconstructPhaseEngineFromEvents(
      'run-e2e',
      events,
      DEFAULT_PHASED_EXECUTION_SETTINGS
    );
    expect(rebuilt).not.toBeNull();
    const live = engine.snapshot();
    expect(rebuilt!.currentPhase).toBe(live.currentPhase);
    expect(rebuilt!.activeSubtaskId).toBe(live.activeSubtaskId);
    expect(rebuilt!.ledgerEntryIds).toEqual(live.ledgerEntryIds);
    expect(rebuilt!.doneCriteria).toEqual(live.doneCriteria);
    expect(rebuilt!.planSteps).toEqual(live.planSteps);
    expect(rebuilt!.guards.repeatFailureCount).toBe(live.guards.repeatFailureCount);
    expect(rebuilt!.seq).toBe(live.seq);
  });
});
