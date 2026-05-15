/**
 * Defect 2 regression: when a tool fails, the renderer must surface
 * the actionable message that lives in `result.output`, not just the
 * one-word `result.error` tag (e.g. "ambiguous", "no match",
 * "missing path", "permission denied", …).
 *
 * The collapsed-row `errorHint` inline preview keeps using the short
 * tag — it's a one-line breadcrumb, not the place for a paragraph —
 * but the EXPANDED danger pane must show the full message so the
 * user can act on it (e.g. set `replaceAll: true`, re-read the file
 * to refresh `oldString`, etc.).
 *
 * Same fix applies to the two adjacent invocations that share the
 * bug shape: `ReadInvocation`, `LsInvocation`.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInvocation } from '@renderer/components/timeline/tools/EditInvocation';
import { ReadInvocation } from '@renderer/components/timeline/tools/ReadInvocation';
import { LsInvocation } from '@renderer/components/timeline/tools/LsInvocation';
import type { ToolCall, ToolResult } from '@shared/types/tool';

const AMBIGUOUS_OUTPUT =
  '`oldString` matches 2 locations in src/snake.py. Either set ' +
  '`replaceAll: true` or expand the context to a unique match.';

describe('EditInvocation error pane (defect 2)', () => {
  it('shows the actionable output in the danger pane, not the short tag', async () => {
    const call: ToolCall = {
      id: 'call-1',
      name: 'edit',
      args: { path: 'src/snake.py', oldString: 'x', newString: 'y' }
    };
    const result: ToolResult = {
      id: 'r-1',
      name: 'edit',
      ok: false,
      output: AMBIGUOUS_OUTPUT,
      error: 'ambiguous',
      durationMs: 1
    };
    render(<EditInvocation call={call} result={result} />);
    // Collapsed: the inline errorHint keeps the short tag.
    expect(screen.getByText('ambiguous')).toBeInTheDocument();

    // Expand. The button label is the row's title — "edit".
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    // Danger pane now contains the full actionable message.
    expect(screen.getByText(AMBIGUOUS_OUTPUT)).toBeInTheDocument();
  });

  it('falls back to the short tag when output is empty', async () => {
    const result: ToolResult = {
      id: 'r-2',
      name: 'edit',
      ok: false,
      output: '',
      error: 'permission denied',
      durationMs: 1
    };
    const call: ToolCall = {
      id: 'call-2',
      name: 'edit',
      args: { path: 'src/foo.ts' }
    };
    render(<EditInvocation call={call} result={result} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    // Two nodes hold the text: the collapsed errorHint (still rendered
    // even when expanded — it lives in the row, not the pane) and the
    // pane itself. Either way, the assertion is that "permission
    // denied" surfaces somewhere visible.
    expect(screen.getAllByText('permission denied').length).toBeGreaterThan(0);
  });
});

describe('ReadInvocation error pane (defect 2)', () => {
  it('shows the actionable output instead of the short error tag', async () => {
    const call: ToolCall = {
      id: 'rc-1',
      name: 'read',
      args: { path: 'src/missing.ts' }
    };
    const longOutput =
      'Cannot read src/missing.ts: ENOENT: no such file or directory. ' +
      'Use `ls` to confirm the file is present before re-trying.';
    const result: ToolResult = {
      id: 'rr-1',
      name: 'read',
      ok: false,
      output: longOutput,
      error: 'ENOENT',
      durationMs: 1
    };
    render(<ReadInvocation call={call} result={result} />);
    await userEvent.click(screen.getByRole('button', { name: /read/i }));
    expect(screen.getByText(longOutput)).toBeInTheDocument();
  });
});

describe('LsInvocation error pane (defect 2)', () => {
  it('shows the actionable output instead of the short error tag', async () => {
    const call: ToolCall = {
      id: 'lc-1',
      name: 'ls',
      args: { path: '../../etc' }
    };
    const longOutput =
      'Sandbox error: path resolves outside the workspace root. ' +
      'Use a path relative to the workspace.';
    const result: ToolResult = {
      id: 'lr-1',
      name: 'ls',
      ok: false,
      output: longOutput,
      error: 'sandbox',
      durationMs: 1
    };
    render(<LsInvocation call={call} result={result} />);
    await userEvent.click(screen.getByRole('button', { name: /ls/i }));
    expect(screen.getByText(longOutput)).toBeInTheDocument();
  });
});
