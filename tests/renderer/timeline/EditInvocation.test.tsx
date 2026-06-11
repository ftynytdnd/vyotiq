/**
 * `EditInvocation` snippet diff DOM caps.
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

function snippetText(): string {
  const el = document.querySelector('[data-snippet-diff]');
  return el?.textContent ?? '';
}

describe('EditInvocation DOM caps', () => {
  it('renders every line when under the snippet cap', async () => {
    render(<EditInvocation call={call} result={makeResult(makeHunks(5, 3))} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.queryByText(/more line/)).toBeNull();
    expect(snippetText()).toMatch(/hunk4-2/);
  });

  it('truncates to MAX_VISIBLE_LINES and shows an overflow row', async () => {
    render(<EditInvocation call={call} result={makeResult(makeHunks(200, 1))} />);
    await userEvent.click(screen.getByRole('button'));
    expect(snippetText()).toMatch(/hunk159-0/);
    expect(snippetText()).not.toMatch(/hunk160-0/);
    expect(screen.getByText(/40 more lines/)).toBeInTheDocument();
  });

  it('truncates lines within a single hunk', async () => {
    render(<EditInvocation call={call} result={makeResult(makeHunks(1, 250))} />);
    await userEvent.click(screen.getByRole('button'));
    expect(snippetText()).toMatch(/hunk0-159/);
    expect(snippetText()).not.toMatch(/hunk0-160/);
    expect(screen.getByText(/90 more lines/)).toBeInTheDocument();
  });
});
