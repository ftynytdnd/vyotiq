/**
 * Settle test — when the authoritative `tool-result` arrives, the
 * pending card swaps to authoritative and `data-variant` updates.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInvocation } from '@renderer/components/timeline/tools/EditInvocation';
import type { DiffHunk, ToolCall, ToolResult } from '@shared/types/tool';

const PATH = 'src/snake.py';

const call: ToolCall = {
  id: 'c-settle',
  name: 'edit',
  args: {
    path: PATH,
    oldString: 'old_line',
    newString: 'new_line'
  }
};

const authoritativeHunk: DiffHunk = {
  oldStart: 42,
  newStart: 42,
  lines: [
    { kind: ' ', text: 'context_before' },
    { kind: '-', text: 'old_line' },
    { kind: '+', text: 'new_line' },
    { kind: ' ', text: 'context_after' }
  ]
};

function makeResult(): ToolResult {
  return {
    id: 'r-settle',
    name: 'edit',
    ok: true,
    output: '',
    durationMs: 5,
    data: {
      tool: 'edit',
      filePath: PATH,
      additions: 1,
      deletions: 1,
      created: false,
      hunks: [authoritativeHunk]
    }
  };
}

describe('EditInvocation — preview → authoritative settle', () => {
  it('transitions the status chip and variant attr when result lands', async () => {
    const { rerender, container } = render(<EditInvocation call={call} />);

    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    const previewNode = container.querySelector('[data-snippet-diff][data-variant="preview"]');
    expect(previewNode).not.toBeNull();

    rerender(<EditInvocation call={call} result={makeResult()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.queryByText(/^pending$/i)).toBeNull();
    const authNode = container.querySelector('[data-snippet-diff][data-variant="authoritative"]');
    expect(authNode).not.toBeNull();
    expect(container.querySelector('[data-snippet-diff][data-variant="preview"]')).toBeNull();

    expect(screen.getByText('context_before')).toBeInTheDocument();
    expect(screen.getByText('context_after')).toBeInTheDocument();
  });
});
