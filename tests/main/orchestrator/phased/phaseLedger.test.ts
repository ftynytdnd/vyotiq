/**
 * Ledger completeness/queryability (audit M2, M3).
 *
 * INTAKE and PLAN artifacts must emit structured, queryable ledger fields
 * (not only a JSON `artifactSummary` string), and DIAGNOSE must record the
 * failed *approach* — derived from the classification — rather than the routing
 * target phase.
 */

import { describe, expect, it, vi } from 'vitest';
import { PhaseEngine } from '../../../../src/main/orchestrator/phased/phaseEngine.js';
import { DEFAULT_PHASED_EXECUTION_SETTINGS } from '../../../../src/shared/settings/phasedExecutionSettings.js';
import type { TimelineEvent } from '../../../../src/shared/types/chat.js';

vi.mock('../../../../src/main/orchestrator/phased/checkpointMarker.js', () => ({
  recordCheckpointMarker: vi.fn(async () => ({ checkpointId: 'cp', lastEntryId: '', entryCount: 0 })),
  revertEntriesAfterMarker: vi.fn(async () => ({ ok: true, reverted: 0 }))
}));

function makeEngine(events: TimelineEvent[]): PhaseEngine {
  return new PhaseEngine({
    runId: 'run-ledger',
    workspaceId: 'ws',
    workspacePath: '/tmp/ws',
    prompt: 'implement a feature',
    settings: { ...DEFAULT_PHASED_EXECUTION_SETTINGS, mode: 'always' },
    emit: (e) => events.push(e)
  });
}

type LedgerEntry = Extract<TimelineEvent, { kind: 'phase-ledger-entry' }>;
// The constructor emits a mode-decision ledger entry for the initial phase, so
// the artifact entry for a phase is the LAST entry matching that phase.
function ledgerFor(events: TimelineEvent[], phase: string): LedgerEntry | undefined {
  const matches = events.filter(
    (e): e is LedgerEntry => e.kind === 'phase-ledger-entry' && e.phase === phase
  );
  return matches[matches.length - 1];
}

describe('phased ledger structured fields', () => {
  it('captures intake done-criteria and acceptance command count', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'intake',
      artifact: {
        phase: 'intake',
        goalRestatement: 'build it',
        doneCriteria: [
          { id: 'c1', description: 'works' },
          { id: 'c2', description: 'tested' }
        ],
        acceptanceCommands: ['npm test', 'npm run lint']
      }
    });
    const entry = ledgerFor(events, 'intake');
    expect(entry?.doneCriteria?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(entry?.acceptanceCommandCount).toBe(2);
  });

  it('captures plan steps as structured fields', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'intake',
      artifact: {
        phase: 'intake',
        goalRestatement: 'build it',
        doneCriteria: [{ id: 'c1', description: 'works' }],
        acceptanceCommands: ['npm test']
      }
    });
    engine.currentPhase = 'plan';
    await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'plan',
      artifact: {
        phase: 'plan',
        steps: [
          {
            subtaskId: engine.activeSubtaskId,
            order: 1,
            description: 'add guard',
            doneCriterionId: 'c1',
            verificationMethod: 'npm test'
          }
        ]
      }
    });
    const entry = ledgerFor(events, 'plan');
    expect(entry?.planSteps?.length).toBe(1);
    expect(entry?.planSteps?.[0]?.doneCriterionId).toBe('c1');
  });

  it('records the failed approach for diagnose, not the routing target', async () => {
    const events: TimelineEvent[] = [];
    const engine = makeEngine(events);
    engine.currentPhase = 'diagnose';
    engine.ledgerEntryIds = ['real-1'];
    await engine.handlePhaseGateArgs({
      subtaskId: engine.activeSubtaskId,
      phase: 'diagnose',
      artifact: {
        phase: 'diagnose',
        classification: 'wrong_facts',
        targetPhase: 'understand',
        evidence: 'misread the parser',
        citeLedgerEntryId: 'real-1'
      }
    });
    const entry = ledgerFor(events, 'diagnose');
    expect(entry?.attemptedApproaches?.[0]?.approach).toBe('Prior understanding of the code');
    expect(entry?.attemptedApproaches?.[0]?.whyFailed).toBe('misread the parser');
    // Must NOT record the routing target phase as the "approach".
    expect(entry?.attemptedApproaches?.[0]?.approach).not.toBe('understand');
  });
});
