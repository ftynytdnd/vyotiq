import { describe, expect, it } from 'vitest';
import {
  exitCriteriaForPhase,
  nextPhaseAfter,
  parsePhaseGateArgs,
  phaseLabel
} from '../../../../src/main/orchestrator/phased/gateValidators.js';

describe('parsePhaseGateArgs intake gate', () => {
  it('requires acceptance commands at intake', () => {
    const r = parsePhaseGateArgs({
      subtaskId: 'st1',
      phase: 'intake',
      artifact: {
        phase: 'intake',
        goalRestatement: 'Build feature X',
        doneCriteria: [{ id: 'c1', description: 'Tests pass' }],
        acceptanceCommands: []
      }
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('acceptanceCommand');
  });

  it('accepts valid intake artifact', () => {
    const r = parsePhaseGateArgs({
      subtaskId: 'st1',
      phase: 'intake',
      artifact: {
        phase: 'intake',
        goalRestatement: 'Build feature X',
        doneCriteria: [{ id: 'c1', description: 'Tests pass' }],
        acceptanceCommands: ['npm test']
      }
    });
    expect(r.ok).toBe(true);
  });
});

describe('parsePhaseGateArgs understand gate', () => {
  it('rejects open ambiguities', () => {
    const r = parsePhaseGateArgs({
      subtaskId: 'st1',
      phase: 'understand',
      artifact: {
        phase: 'understand',
        facts: [{ statement: 'foo.ts exports bar', codeLinks: [{ file: 'src/foo.ts', line: 1 }] }],
        openAmbiguities: ['unclear API']
      }
    });
    expect(r.ok).toBe(false);
  });
});

describe('phase helpers', () => {
  it('nextPhaseAfter follows machine order', () => {
    expect(nextPhaseAfter('intake')).toBe('understand');
    expect(nextPhaseAfter('execute')).toBe('verify');
    expect(nextPhaseAfter('verify')).toBe('reflect');
  });

  it('exitCriteriaForPhase is non-empty for every phase', () => {
    for (const phase of [
      'intake',
      'understand',
      'think_frame',
      'plan',
      'rethink',
      'checkpoint',
      'execute',
      'verify',
      'diagnose',
      'reflect',
      'done'
    ] as const) {
      expect(exitCriteriaForPhase(phase).length).toBeGreaterThan(0);
      expect(phaseLabel(phase).length).toBeGreaterThan(0);
    }
  });
});
