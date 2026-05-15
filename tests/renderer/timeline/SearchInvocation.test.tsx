/**
 * `SearchInvocation` Phase-2 DOM cap. Many matches must produce a
 * bounded number of rows plus an overflow row.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchInvocation } from '@renderer/components/timeline/tools/SearchInvocation';
import type { SearchMatch, ToolCall, ToolResult } from '@shared/types/tool';

function makeMatches(n: number): SearchMatch[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/file-${i % 5}.ts`,
    line: i + 1,
    preview: `match preview ${i}`
  }));
}

function makeResult(matches: SearchMatch[]): ToolResult {
  return {
    id: 'r1',
    name: 'search',
    ok: true,
    output: '',
    durationMs: 1,
    data: {
      tool: 'search',
      mode: 'local',
      query: 'foo',
      matches,
      truncated: false
    }
  } as ToolResult;
}

const call = {
  id: 'call-1',
  name: 'search' as never,
  args: { mode: 'local', query: 'foo' }
} as ToolCall;

describe('SearchInvocation DOM cap', () => {
  it('renders all matches when under the cap', async () => {
    // Omit rowKey so InvocationShell uses local expand state instead
    // of the persistent store (which needs a bound conversation).
    render(<SearchInvocation call={call} result={makeResult(makeMatches(10))} />);
    await userEvent.click(screen.getByRole('button'));
    for (let i = 0; i < 10; i++) {
      expect(screen.getByText(`match preview ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/more match/)).toBeNull();
  });

  it('truncates to 200 matches and shows an overflow row', async () => {
    render(<SearchInvocation call={call} result={makeResult(makeMatches(350))} />);
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('match preview 199')).toBeInTheDocument();
    expect(screen.queryByText('match preview 200')).toBeNull();
    expect(screen.getByText(/150 more matches not shown/)).toBeInTheDocument();
  });
});
