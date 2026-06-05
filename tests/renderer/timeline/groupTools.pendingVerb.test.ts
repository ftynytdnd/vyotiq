import { describe, expect, it } from 'vitest';
import { toolGroupSummary } from '@renderer/components/timeline/reducer/deriveRows/groupTools';

describe('toolGroupSummary pending verbs', () => {
  it('uses progressive tense for partial-only delete previews', () => {
    const { verb } = toolGroupSummary('delete', [
      {
        callId: 'c1',
        partial: true,
        call: { id: 'c1', name: 'delete', args: { path: 'docs/architecture.md' } }
      }
    ]);
    expect(verb).toBe('Deleting');
  });
});
