import { describe, expect, it } from 'vitest';
import {
  buildRunStateXml,
  createRunStateAccumulator,
  snapshotRunState
} from '@main/orchestrator/loop/buildRunState';
import { MAX_TOTAL_ITERATIONS } from '@shared/constants';
import { createSpinSignatureBuffer } from '@main/orchestrator/loop/toolSpinSignature';

describe('buildRunStateXml', () => {
  it('renders iteration, tool rounds, last action, and spin', () => {
    const acc = createRunStateAccumulator();
    acc.iteration = 2;
    acc.toolRoundsTotal = 1;
    acc.lastAction = 'tool';
    const xml = buildRunStateXml(snapshotRunState(acc, createSpinSignatureBuffer(), 0));
    expect(xml).toContain(`iteration: 2 of ${MAX_TOTAL_ITERATIONS}`);
    expect(xml).toContain('tool_rounds: 1');
    expect(xml).toContain('last_action: tool');
    expect(xml).toContain('spin_signature_hot:');
  });

  it('starts clean', () => {
    const acc = createRunStateAccumulator();
    expect(acc.lastAction).toBe('none');
    expect(acc.toolRoundsTotal).toBe(0);
  });
});
