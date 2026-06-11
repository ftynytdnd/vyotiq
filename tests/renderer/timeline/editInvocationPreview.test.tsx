/**
 * Live diff preview — Level 1 of the plan.
 *
 * Once a `tool-call` event lands but BEFORE the matching
 * `tool-result` arrives, `EditInvocation` synthesizes a diff from
 * the call's own `oldString` / `newString` (or `content` for
 * `create: true`). The expanded detail pane is labelled
 * `preview (pending)` (or `new file (pending)`) so users can tell
 * a predictive view from an authoritative one.
 *
 * The synthetic view is purely a function of the call arguments —
 * no IPC, no main-process work, no new wire events.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInvocation } from '@renderer/components/timeline/tools/EditInvocation';
import type { ToolCall } from '@shared/types/tool';

function call(args: Record<string, unknown>): ToolCall {
  return { id: 'call-preview', name: 'edit', args };
}

describe('EditInvocation — pre-result synthetic preview', () => {
  it('renders a pending preview hunk from oldString / newString', async () => {
    render(
      <EditInvocation
        call={call({
          path: 'src/snake.py',
          oldString: 'def foo():\n    return 1',
          newString: 'def foo():\n    return 2'
        })}
      />
    );
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    const renderedLines = Array.from(
      document.querySelectorAll<HTMLElement>('.vx-snippet-diff-line')
    ).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(
      renderedLines.some((t) => /return 2/.test(t))
    ).toBe(true);
    expect(
      renderedLines.some((t) => /return 1/.test(t))
    ).toBe(true);
    // Anchor line preserved as context (LCS, not all-red-all-green).
    expect(
      renderedLines.some((t) => /def foo\(\):/.test(t))
    ).toBe(true);
  });

  it('renders a "new file (pending)" preview for create:true', async () => {
    render(
      <EditInvocation
        call={call({
          path: 'src/new.ts',
          create: true,
          content: 'export const HELLO = 1;\n'
        })}
      />
    );
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(document.body.textContent ?? '').toMatch(/export const HELLO = 1;/);
  });

  it('does not render the preview pane when args are incomplete', async () => {
    render(<EditInvocation call={call({ path: 'src/foo.ts' })} />);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });
});
