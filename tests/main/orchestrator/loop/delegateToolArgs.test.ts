import { describe, expect, it } from 'vitest';
import { coerceDelegateSpecsFromParsed } from '@main/orchestrator/loop/delegateToolArgs';

describe('coerceDelegateSpecsFromParsed', () => {
  it('parses multiple delegates from a delegates array', () => {
    const specs = coerceDelegateSpecsFromParsed({
      delegates: [
        { id: 'w1', task: 'task one', files: [], tools: ['read'] },
        { id: 'w2', task: 'task two', files: [], tools: ['read'] }
      ]
    });
    expect(specs).toHaveLength(2);
    expect(specs.map((s) => s.id)).toEqual(['w1', 'w2']);
  });

  it('applies batch-root concurrency to specs that omit it', () => {
    const specs = coerceDelegateSpecsFromParsed({
      concurrency: 6,
      delegates: [
        { id: 'w1', task: 'one', files: [], tools: [] },
        { id: 'w2', task: 'two', files: [], tools: [], concurrency: 2 }
      ]
    });
    expect(specs[0]?.concurrency).toBe(6);
    expect(specs[1]?.concurrency).toBe(2);
  });
});
