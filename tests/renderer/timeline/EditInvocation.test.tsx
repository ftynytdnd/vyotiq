/**
 * `EditInvocation` Phase-2 DOM caps on hunks and lines per hunk.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInvocation } from '@renderer/components/timeline/tools/EditInvocation';
import type { DiffHunk, ToolCall, ToolResult } from '@shared/types/tool';

function lineText(prefix: string, n: number): { kind: ' ' | '+' | '-'; text: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: '+' as const,
    text: `${prefix}-${i}`
  }));
}

function makeHunks(n: number, linesEach: number): DiffHunk[] {
  return Array.from({ length: n }, (_, i) => ({
    oldStart: i * 10 + 1,
    newStart: i * 10 + 1,
    lines: lineText(`hunk${i}`, linesEach)
  }));
}

function makeResult(hunks: DiffHunk[]): ToolResult {
  return {
    id: 'r1',
    name: 'edit',
    ok: true,
    output: '',
    durationMs: 1,
    data: {
      tool: 'edit',
      filePath: 'src/foo.ts',
      additions: hunks.reduce((a, h) => a + h.lines.length, 0),
      deletions: 0,
      created: false,
      hunks
    }
  } as ToolResult;
}

const call = {
  id: 'call-1',
  name: 'edit' as never,
  args: { path: 'src/foo.ts' }
} as ToolCall;

describe('EditInvocation DOM caps', () => {
  it('renders every hunk when under the 30-hunk cap', async () => {
    // Omit rowKey so InvocationShell uses local expand state.
    render(<EditInvocation call={call} result={makeResult(makeHunks(5, 3))} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.queryByText(/more hunk/)).toBeNull();
    expect(screen.getByText('hunk4-2')).toBeInTheDocument();
  });

  it('truncates hunks to MAX and shows an overflow row', async () => {
    render(<EditInvocation call={call} result={makeResult(makeHunks(50, 1))} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('hunk29-0')).toBeInTheDocument();
    expect(screen.queryByText('hunk30-0')).toBeNull();
    // Overflow row now offers an interactive "show all" affordance;
    // the count + "show all" copy live on the same button.
    expect(screen.getByText(/20 more hunks.*show all/i)).toBeInTheDocument();
  });

  it('truncates lines within a single hunk', async () => {
    render(<EditInvocation call={call} result={makeResult(makeHunks(1, 250))} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('hunk0-199')).toBeInTheDocument();
    expect(screen.queryByText('hunk0-200')).toBeNull();
    expect(screen.getByText(/50 more lines in this hunk/)).toBeInTheDocument();
  });
});
