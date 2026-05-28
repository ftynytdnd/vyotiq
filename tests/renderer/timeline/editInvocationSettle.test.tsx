/**
 * Settle test — when the authoritative `tool-result` arrives, the
 * `preview (pending)` pane swaps to the `diff` pane and the
 * underlying `EditDiffView` container changes its `data-variant`
 * from `preview` to `authoritative`.
 *
 * The CSS animation itself (the `.vyotiq-diff-settle` cascade) is
 * not asserted here — happy-dom doesn't run animations. The
 * variant transition is the testable surface: the renderer keys
 * the diff container on `variant` so React unmounts the preview
 * tree and mounts the authoritative tree, which is what re-fires
 * the keyframe at runtime.
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
  it('transitions the pane label and the variant attr when result lands', async () => {
    const { rerender, container } = render(<EditInvocation call={call} />);

    // Pre-result: pane label "preview (pending)", variant=preview.
    expect(screen.getByText(/preview \(pending\)/i)).toBeInTheDocument();
    const previewNode = container.querySelector('[data-variant="preview"]');
    expect(previewNode).not.toBeNull();

    // Result lands — row auto-collapses when no longer in-flight.
    rerender(<EditInvocation call={call} result={makeResult()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    // Pane label flips to "diff"; preview marker is gone.
    expect(screen.queryByText(/preview \(pending\)/i)).toBeNull();
    expect(screen.getByText(/^diff$/i)).toBeInTheDocument();
    const authNode = container.querySelector('[data-variant="authoritative"]');
    expect(authNode).not.toBeNull();
    expect(container.querySelector('[data-variant="preview"]')).toBeNull();

    // Context lines from the authoritative hunk are visible — proves
    // the swap is data-bound, not just label-bound.
    expect(screen.getByText('context_before')).toBeInTheDocument();
    expect(screen.getByText('context_after')).toBeInTheDocument();
  });
});
