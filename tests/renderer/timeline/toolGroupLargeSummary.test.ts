import { describe, expect, it } from 'vitest';
import { toolGroupSummary } from '@renderer/components/timeline/reducer/deriveRows/groupTools';
import type { ToolGroupChild } from '@renderer/components/timeline/reducer/deriveRows';

function makeChildren(n: number): ToolGroupChild[] {
  return Array.from({ length: n }, (_, i) => ({
    callId: `c${i}`,
    call: { id: `c${i}`, name: 'read', args: { path: `file-${i}.ts` } }
  }));
}

describe('toolGroupSummary large groups', () => {
  it('uses compact count wording for 10+ calls', () => {
    const summary = toolGroupSummary('read', makeChildren(12));
    expect(summary.verb).toBe('12');
    expect(summary.primary).toBe('read calls');
  });
});
