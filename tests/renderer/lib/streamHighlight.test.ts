import { describe, expect, it } from 'vitest';
import { highlightStreamingCode } from '@renderer/lib/streamHighlight';

describe('highlightStreamingCode', () => {
  it('returns null for unknown languages', () => {
    expect(highlightStreamingCode('not-a-real-lang', 'const x = 1')).toBeNull();
  });

  it('highlights known fenced languages', () => {
    const result = highlightStreamingCode('typescript', 'const x = 1;');
    expect(result).not.toBeNull();
    expect(result!.language).toBe('typescript');
    expect(result!.html).toContain('hljs-');
  });
});
