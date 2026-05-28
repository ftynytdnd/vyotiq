import { describe, expect, it } from 'vitest';
import { countSuccessfulInlines } from '@main/orchestrator/contextManager';

describe('countSuccessfulInlines', () => {
  it('counts bodies inlined with a newline after the opening tag', () => {
    const block =
      '<file path="a.ts">\nbody\n</file>\n\n' +
      '<file path="b.ts">\nmore\n</file>';
    expect(countSuccessfulInlines(block)).toBe(2);
  });

  it('ignores self-closing error blocks', () => {
    const block =
      '<file path="missing.ts" error="ENOENT" />\n\n' +
      '<file path="ok.ts">\ncontent\n</file>';
    expect(countSuccessfulInlines(block)).toBe(1);
  });

  it('returns 0 for an empty block', () => {
    expect(countSuccessfulInlines('')).toBe(0);
  });
});
