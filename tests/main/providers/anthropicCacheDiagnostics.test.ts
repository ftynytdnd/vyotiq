import { describe, expect, it } from 'vitest';
import { parseAnthropicCacheDiagnostics } from '../../../src/main/providers/cacheHints/anthropicCacheDiagnostics.js';

describe('parseAnthropicCacheDiagnostics', () => {
  it('returns null reason when comparison is pending', () => {
    expect(parseAnthropicCacheDiagnostics({ cache_miss_reason: null })).toEqual({
      cacheMissReason: null
    });
  });

  it('extracts miss reason type', () => {
    expect(
      parseAnthropicCacheDiagnostics({
        cache_miss_reason: { type: 'system_changed', index: 0 }
      })
    ).toEqual({ cacheMissReason: 'system_changed' });
  });

  it('returns undefined for absent diagnostics', () => {
    expect(parseAnthropicCacheDiagnostics(undefined)).toBeUndefined();
  });
});
