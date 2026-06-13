import { describe, expect, it } from 'vitest';
import { sanitizeCompletionText } from '../../../src/shared/completion/sanitizeCompletionText.js';

describe('sanitizeCompletionText', () => {
  it('strips markdown fences for editor output', () => {
    expect(sanitizeCompletionText('```ts\nconst x = 1;\n```', 'editor')).toBe('const x = 1;');
  });

  it('caps composer continuation to first line when long', () => {
    const raw = 'Continue fixing the auth middleware\n\nAlso update tests.';
    expect(sanitizeCompletionText(raw, 'composer')).toBe('Continue fixing the auth middleware');
  });

  it('returns empty for whitespace-only', () => {
    expect(sanitizeCompletionText('   \n  ', 'composer')).toBe('');
  });
});
