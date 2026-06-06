import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../../../../src/main/tools/policy/agentTools.js';
import { listTools } from '../../../../src/main/tools/registry.js';

describe('AGENT_TOOLS', () => {
  it('matches every registered tool except unknown', () => {
    const names = new Set(listTools().map((t) => t.name));
    for (const n of AGENT_TOOLS) {
      expect(names.has(n)).toBe(true);
    }
    expect(AGENT_TOOLS).not.toContain('delegate' as never);
    expect(AGENT_TOOLS).toContain('report');
  });
});
