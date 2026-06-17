import { describe, expect, it } from 'vitest';
import { deriveRows } from '../../../src/renderer/components/timeline/reducer/deriveRows.js';
import type { TimelineEvent } from '../../../src/shared/types/chat.js';

describe('deriveRows phased events', () => {
  it('folds phase-gate onto preceding phase-log and emits phase-ledger row', () => {
    const events: TimelineEvent[] = [
      { kind: 'phase', id: 'p1', ts: 1, label: 'Intake' },
      {
        kind: 'phase-gate',
        id: 'g1',
        ts: 2,
        runId: 'r1',
        subtaskId: 's1',
        seq: 1,
        phase: 'intake',
        exitCriteria: 'criteria',
        gateDecision: { kind: 'passed', reason: 'ok' }
      },
      {
        kind: 'phase-ledger-entry',
        id: 'l1',
        ts: 3,
        runId: 'r1',
        subtaskId: 's1',
        seq: 2,
        phase: 'intake',
        artifactSummary: '{"phase":"intake"}'
      }
    ];
    const rows = deriveRows(events);
    const phaseLog = rows.find((r) => r.kind === 'phase-log');
    const ledger = rows.find((r) => r.kind === 'phase-ledger');
    expect(phaseLog?.kind).toBe('phase-log');
    if (phaseLog?.kind === 'phase-log') {
      expect(phaseLog.gateDecision?.kind).toBe('passed');
    }
    expect(ledger?.kind).toBe('phase-ledger');
  });

  it('passes structured ledger fields and folds acceptance evidence', () => {
    const events: TimelineEvent[] = [
      { kind: 'phase', id: 'p1', ts: 1, label: 'Verify + Tests' },
      {
        kind: 'phase-gate',
        id: 'g1',
        ts: 2,
        runId: 'r1',
        subtaskId: 's1',
        seq: 1,
        phase: 'verify',
        exitCriteria: 'tests pass',
        gateDecision: { kind: 'passed', reason: 'green' },
        acceptanceEvidence: [{ command: 'npm test', exitCode: 0, output: 'ok', timedOut: false }]
      },
      {
        kind: 'phase-ledger-entry',
        id: 'l1',
        ts: 3,
        runId: 'r1',
        subtaskId: 's1',
        seq: 2,
        phase: 'think_frame',
        decisions: [{ decision: 'extend parser', rationale: 'rejected rewrite: risky' }],
        discoveredConstraints: ['no new deps'],
        codeLinks: [{ file: 'foo.ts', line: 4 }]
      }
    ];
    const rows = deriveRows(events);
    const phaseLog = rows.find((r) => r.kind === 'phase-log');
    const ledger = rows.find((r) => r.kind === 'phase-ledger');
    if (phaseLog?.kind === 'phase-log') {
      expect(phaseLog.acceptanceEvidence?.[0]?.command).toBe('npm test');
    }
    if (ledger?.kind === 'phase-ledger') {
      expect(ledger.decisions?.[0]?.decision).toBe('extend parser');
      expect(ledger.discoveredConstraints).toEqual(['no new deps']);
      expect(ledger.codeLinks?.[0]?.file).toBe('foo.ts');
    }
  });
});
