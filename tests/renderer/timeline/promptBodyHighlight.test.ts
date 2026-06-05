import { describe, expect, it } from 'vitest';
import { renderPromptBodyContent } from '@renderer/components/timeline/rows/promptBodyHighlight.js';

describe('renderPromptBodyContent', () => {
  it('wraps known mention paths in highlight spans', () => {
    const nodes = renderPromptBodyContent('see @src/a.ts now', [
      { kind: 'file', id: '1', label: 'src/a.ts', workspacePath: 'src/a.ts' }
    ]);
    expect(nodes).toHaveLength(3);
    expect(nodes[1]).toMatchObject({
      props: { className: 'vx-mention-highlight', children: '@src/a.ts' }
    });
  });
});
