import { describe, expect, it, vi } from 'vitest';
import { PhaseEngine } from '../../../../src/main/orchestrator/phased/phaseEngine.js';
import { interceptPhaseGate } from '../../../../src/main/orchestrator/loop/phaseGateIntercept.js';
import { DEFAULT_PHASED_EXECUTION_SETTINGS } from '../../../../src/shared/settings/phasedExecutionSettings.js';
import type { ChatMessage, TimelineEvent } from '../../../../src/shared/types/chat.js';

vi.mock('../../../../src/main/orchestrator/phased/checkpointMarker.js', () => ({
  recordCheckpointMarker: vi.fn(async () => ({ checkpointId: 'cp', lastEntryId: '', entryCount: 0 })),
  revertEntriesAfterMarker: vi.fn(async () => ({ ok: true, reverted: 0 }))
}));

function makeEngine(): PhaseEngine {
  return new PhaseEngine({
    runId: 'run-i',
    workspaceId: 'ws',
    workspacePath: '/tmp/ws',
    prompt: 'implement a feature',
    settings: { ...DEFAULT_PHASED_EXECUTION_SETTINGS, mode: 'always' },
    emit: () => {}
  });
}

function run(engine: PhaseEngine, args: unknown) {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '' }
  ];
  const events: TimelineEvent[] = [];
  return interceptPhaseGate({
    engine,
    tc: { id: 'tc1', name: 'phase_gate', argumentsBuf: JSON.stringify(args) },
    messages,
    emit: (e) => events.push(e),
    runId: 'run-i'
  }).then((outcome) => ({ outcome, events, messages }));
}

describe('interceptPhaseGate', () => {
  it('advances on a valid gate and settles an ok tool result', async () => {
    const engine = makeEngine();
    const { outcome, events } = await run(engine, {
      subtaskId: engine.activeSubtaskId,
      phase: 'intake',
      artifact: {
        phase: 'intake',
        goalRestatement: 'do it',
        doneCriteria: [{ id: 'c1', description: 'works' }],
        acceptanceCommands: ['npm test']
      }
    });
    expect(outcome.kind).toBe('continued');
    if (outcome.kind === 'continued') expect(outcome.result.kind).toBe('advanced');
    const toolResult = events.find((e) => e.kind === 'tool-result');
    expect(toolResult && (toolResult as { result: { ok: boolean } }).result.ok).toBe(true);
  });

  it('returns a blocked gate to the agent (no pause) with a failed tool result', async () => {
    const engine = makeEngine();
    engine.currentPhase = 'diagnose';
    engine.ledgerEntryIds = ['real-entry'];
    const { outcome, events } = await run(engine, {
      subtaskId: engine.activeSubtaskId,
      phase: 'diagnose',
      artifact: {
        phase: 'diagnose',
        classification: 'bad_implementation',
        targetPhase: 'execute',
        evidence: 'tests failed',
        citeLedgerEntryId: 'does-not-exist'
      }
    });
    expect(outcome.kind).toBe('continued');
    if (outcome.kind === 'continued') expect(outcome.result.kind).toBe('blocked');
    const toolResult = events.find((e) => e.kind === 'tool-result');
    expect(toolResult && (toolResult as { result: { ok: boolean } }).result.ok).toBe(false);
  });

  it('signals all_done when the final reflect closes the run', async () => {
    const engine = makeEngine();
    engine.currentPhase = 'reflect';
    const { outcome } = await run(engine, {
      subtaskId: engine.activeSubtaskId,
      phase: 'reflect',
      artifact: { phase: 'reflect', lessons: ['shipped'], remainingSteps: [] }
    });
    expect(outcome.kind).toBe('all_done');
    expect(engine.currentPhase).toBe('done');
  });
});
