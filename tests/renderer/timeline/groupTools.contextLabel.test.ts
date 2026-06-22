import { describe, expect, it } from 'vitest';
import { toolGroupSummary } from '@renderer/components/timeline/reducer/deriveRows/groupTools';

describe('toolGroupSummary context labels', () => {
  it('renders a loaded pack as "Loaded <pack>" without a redundant "load" word', () => {
    const { verb, primary } = toolGroupSummary('context', [
      {
        callId: 'c1',
        call: {
          id: 'c1',
          name: 'context',
          args: { action: 'load', pack: 'ast-grep-reference' }
        }
      }
    ]);
    expect(verb).toBe('Loaded');
    expect(primary).toBe('ast-grep-reference');
  });

  it('renders a list call as "Loaded catalogue"', () => {
    const { verb, primary } = toolGroupSummary('context', [
      {
        callId: 'c1',
        call: { id: 'c1', name: 'context', args: { action: 'list' } }
      }
    ]);
    expect(verb).toBe('Loaded');
    expect(primary).toBe('catalogue');
  });
});
