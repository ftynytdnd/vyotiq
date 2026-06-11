import { describe, expect, it } from 'vitest';
import {
  truncateToolOutputForContext,
  truncateUtf8Safe
} from '@shared/text/truncateUtf8Safe';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants';

describe('truncateUtf8Safe', () => {
  it('does not split a surrogate pair at the cut boundary', () => {
    const s = 'a' + '\uD83D\uDE00'.repeat(3);
    const out = truncateUtf8Safe(s, 2);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(() => [...out]).not.toThrow();
  });
});

describe('truncateToolOutputForContext', () => {
  it('appends marker when output exceeds MAX_TOOL_OUTPUT_CHARS', () => {
    const huge = 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 500);
    const out = truncateToolOutputForContext(huge);
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
    expect(out.endsWith('\n…[truncated]')).toBe(true);
  });

  it('returns short output unchanged', () => {
    const s = 'ok';
    expect(truncateToolOutputForContext(s)).toBe(s);
  });
});
