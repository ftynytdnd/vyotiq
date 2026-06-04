import { describe, expect, it } from 'vitest';
import { toolGroupSummary } from '@renderer/components/timeline/reducer/deriveRows/groupTools.js';
import type { ToolGroupChild } from '@renderer/components/timeline/reducer/deriveRows.js';

describe('toolGroupSummary — delegate', () => {
  it('uses worker count for multiple delegate calls', () => {
    const children: ToolGroupChild[] = [
      { call: { id: '1', name: 'delegate', args: { id: 'a1' } } },
      { call: { id: '2', name: 'delegate', args: { id: 'a2' } } },
      { call: { id: '3', name: 'delegate', args: { id: 'a3' } } },
      { call: { id: '4', name: 'delegate', args: { id: 'a4' } } }
    ];
    const summary = toolGroupSummary('delegate', children);
    expect(summary.verb).toBe('Spawning');
    expect(summary.primary).toBe('4 workers');
    expect(summary.suffix).toBe('');
  });
});
