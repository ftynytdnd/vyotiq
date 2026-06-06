import { describe, expect, it } from 'vitest';
import { healStreamingMarkdown } from '@renderer/components/timeline/markdown/healStreamingMarkdown.js';

describe('healStreamingMarkdown', () => {
  it('closes an open bold span at the tail', () => {
    const healed = healStreamingMarkdown('**streaming');
    expect(healed).toContain('**streaming**');
  });

  it('closes an open fenced code block', () => {
    const healed = healStreamingMarkdown('```ts\nconst x = 1');
    expect(healed.endsWith('```')).toBe(true);
  });
});
