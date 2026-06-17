import { describe, expect, it } from 'vitest';
import { suggestProvidersForError } from '@renderer/lib/runRecovery';

describe('suggestProvidersForError', () => {
  it('matches provider and billing failures', () => {
    expect(suggestProvidersForError('Provider failed 3 times: Rate limit exceeded.')).toBe(true);
    expect(suggestProvidersForError('OpenRouter: Insufficient balance. Top up or switch providers.')).toBe(
      true
    );
    expect(suggestProvidersForError('ENOENT: no such file')).toBe(false);
  });
});
