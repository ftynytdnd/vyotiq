import { describe, expect, it } from 'vitest';
import { reconstructPhaseEngineFromEvents } from '../../../../src/main/orchestrator/phased/reconstructFromTranscript.js';
import { DEFAULT_PHASED_EXECUTION_SETTINGS } from '../../../../src/shared/settings/phasedExecutionSettings.js';
import type { TimelineEvent } from '../../../../src/shared/types/chat.js';

describe('reconstructPhaseEngineFromEvents', () => {
  it('restores phase and subtask from persisted ledger events', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'phase-ledger-entry',
        id: 'l1',
        ts: 1,
        runId: 'run1',
        subtaskId: 'sub1',
        seq: 1,
        phase: 'intake',
        modeDecision: 'always'
      },
      {
        kind: 'phase-gate',
        id: 'g1',
        ts: 2,
        runId: 'run1',
        subtaskId: 'sub1',
        seq: 2,
        phase: 'intake',
        exitCriteria: 'done',
        gateDecision: { kind: 'passed', reason: 'ok' }
      },
      {
        kind: 'phase-gate',
        id: 'g2',
        ts: 3,
        runId: 'run1',
        subtaskId: 'sub1',
        seq: 3,
        phase: 'understand',
        exitCriteria: 'facts',
        gateDecision: {
          kind: 'looped_back',
          reason: 'missing link',
          targetPhase: 'understand'
        }
      }
    ];
    const snap = reconstructPhaseEngineFromEvents('run1', events, DEFAULT_PHASED_EXECUTION_SETTINGS);
    expect(snap).not.toBeNull();
    expect(snap?.activeSubtaskId).toBe('sub1');
    expect(snap?.active).toBe(true);
    expect(snap?.ledgerEntryIds).toContain('l1');
  });
});
