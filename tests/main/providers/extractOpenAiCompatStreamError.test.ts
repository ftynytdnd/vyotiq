import { describe, expect, it } from 'vitest';
import { extractOpenAiCompatStreamError } from '@main/providers/providerError.js';

describe('extractOpenAiCompatStreamError', () => {
  it('prefers metadata detail over a generic Provider returned error message', () => {
    const msg = extractOpenAiCompatStreamError({
      message: 'Provider returned error',
      metadata: { reason: 'Upstream idle timeout exceeded' }
    });
    expect(msg).toBe('Upstream idle timeout exceeded');
  });

  it('joins message and code when both are specific', () => {
    const msg = extractOpenAiCompatStreamError({
      message: 'billing required',
      code: 402
    });
    expect(msg).toContain('billing required');
    expect(msg).toContain('code=402');
  });
});
