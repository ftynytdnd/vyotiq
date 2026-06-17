import { describe, expect, it } from 'vitest';
import {
  isToolAllowedInPhase,
  toolsAllowedInPhase
} from '../../../../src/main/orchestrator/phased/toolAllowlist.js';
import { EXECUTION_PHASES } from '../../../../src/shared/types/phased.js';

describe('toolAllowlist', () => {
  it('permits mutation tools only in execute', () => {
    for (const tool of ['edit', 'delete'] as const) {
      expect(isToolAllowedInPhase('execute', tool)).toBe(true);
      expect(isToolAllowedInPhase('understand', tool)).toBe(false);
      expect(isToolAllowedInPhase('plan', tool)).toBe(false);
      expect(isToolAllowedInPhase('rethink', tool)).toBe(false);
    }
  });

  it('allows phase_gate in every non-done phase and finish only in done', () => {
    for (const phase of EXECUTION_PHASES) {
      if (phase === 'done') {
        expect(isToolAllowedInPhase(phase, 'finish')).toBe(true);
      } else {
        expect(isToolAllowedInPhase(phase, 'phase_gate')).toBe(true);
        expect(isToolAllowedInPhase(phase, 'finish')).toBe(false);
      }
    }
  });

  it('grants read tools in read-only phases', () => {
    for (const phase of ['understand', 'think_frame', 'plan', 'rethink', 'diagnose'] as const) {
      const tools = toolsAllowedInPhase(phase);
      expect(tools).toContain('read');
      expect(tools).toContain('search');
      expect(tools).not.toContain('bash');
    }
  });

  it('permits bash in execute and verify', () => {
    expect(isToolAllowedInPhase('execute', 'bash')).toBe(true);
    expect(isToolAllowedInPhase('verify', 'bash')).toBe(true);
  });
});
