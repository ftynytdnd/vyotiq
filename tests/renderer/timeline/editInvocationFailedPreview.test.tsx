/**
 * When an `edit` call fails (e.g. `ambiguous`, `no match`, …) the
 * expanded detail pane shows BOTH:
 *
 *   - the error pane carrying the actionable `output` (defect 2);
 *   - a synthetic `intended diff (not applied)` pane built from the
 *     same `oldString` / `newString` the failing call carried.
 *
 * The combination lets the user see exactly what the model TRIED to
 * do — which is the missing context that made the previous
 * "ambiguous" pill so hard to act on.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInvocation } from '@renderer/components/timeline/tools/EditInvocation';
import type { ToolCall, ToolResult } from '@shared/types/tool';

describe('EditInvocation — failed call with parseable args', () => {
  it('shows both the error pane and the intended-diff preview', async () => {
    const call: ToolCall = {
      id: 'c-1',
      name: 'edit',
      args: {
        path: 'src/snake.py',
        oldString: 'old_line',
        newString: 'new_line'
      }
    };
    const result: ToolResult = {
      id: 'r-1',
      name: 'edit',
      ok: false,
      output:
        '`oldString` matches 2 locations in src/snake.py. Either set ' +
        '`replaceAll: true` or expand the context to a unique match.',
      error: 'ambiguous',
      durationMs: 1
    };
    render(<EditInvocation call={call} result={result} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    // Defect 2: full actionable output, not just the short tag.
    expect(screen.getByText(/matches 2 locations/i)).toBeInTheDocument();

    expect(screen.getByText(/not applied/i)).toBeInTheDocument();

    const lines = Array.from(
      document.querySelectorAll<HTMLElement>('.vx-snippet-diff-line')
    ).map((el) => el.textContent ?? '');
    expect(lines.some((t) => /old_line/.test(t))).toBe(true);
    expect(lines.some((t) => /new_line/.test(t))).toBe(true);
  });

  it('omits the intended-diff pane when the failed call has no parseable args', async () => {
    const call: ToolCall = {
      id: 'c-2',
      name: 'edit',
      args: { path: 'src/foo.ts' }
    };
    const result: ToolResult = {
      id: 'r-2',
      name: 'edit',
      ok: false,
      output: 'Error: provide either `create: true` + `content`, or `oldString` + `newString`.',
      error: 'invalid args',
      durationMs: 1
    };
    render(<EditInvocation call={call} result={result} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByText(/provide either/i)).toBeInTheDocument();
    expect(screen.queryByText(/intended diff/i)).toBeNull();
  });
});
