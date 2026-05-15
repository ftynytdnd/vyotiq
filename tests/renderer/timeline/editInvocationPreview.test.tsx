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
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    // Pane label distinguishes preview from authoritative diff.
    expect(screen.getByText(/preview \(pending\)/i)).toBeInTheDocument();
    // The new "return 2" line is rendered as an addition and the old
    // "return 1" line as a deletion. With Phase 1.2 LCS-based
    // synthesis the unchanged `def foo():` becomes a context line
    // and intra-line word diffing splits the changing token (`1` ->
    // `2`) into its own highlighted span. The full `return 2` text
    // therefore lives across two adjacent text nodes (`return ` +
    // `2`), so we walk all rendered diff lines and assert the
    // concatenated text matches.
    const renderedLines = Array.from(
      document.querySelectorAll<HTMLDivElement>(
        '[data-edit-diff-instance] pre > div'
      )
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
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByText(/new file \(pending\)/i)).toBeInTheDocument();
    expect(screen.getByText(/export const HELLO = 1;/)).toBeInTheDocument();
  });

  it('does not render the preview pane when args are incomplete', async () => {
    render(<EditInvocation call={call({ path: 'src/foo.ts' })} />);
    // With no oldString/newString and no create+content, there is
    // nothing to preview. The row collapses cleanly — no expand
    // chevron means the button is disabled.
    const btn = screen.getByRole('button', { name: /edit/i });
    expect(btn).toBeDisabled();
  });
});
