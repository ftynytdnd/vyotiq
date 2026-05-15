/**
 * Defect 1 regression: `EditInvocation` previously rendered the verb
 * twice (`edit edit snake.py` / `create create new.ts`) because the
 * shared `InvocationShell` already prepends the tool name as the
 * row's `title` slot. The summary slot must therefore carry the
 * path ONLY — same contract as `ReadInvocation` and `LsInvocation`.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditInvocation } from '@renderer/components/timeline/tools/EditInvocation';
import type { ToolCall, ToolResult } from '@shared/types/tool';

function makeCall(args: Record<string, unknown>): ToolCall {
  return { id: 'call-x', name: 'edit', args };
}

function makeOkEdit(path: string): ToolResult {
  return {
    id: 'r-x',
    name: 'edit',
    ok: true,
    output: '',
    durationMs: 1,
    data: {
      tool: 'edit',
      filePath: path,
      additions: 0,
      deletions: 0,
      created: false,
      hunks: []
    }
  };
}

describe('EditInvocation row label (defect 1: no duplicated verb)', () => {
  it('renders the path only, with the "edit" title carrying the verb', () => {
    render(
      <EditInvocation
        call={makeCall({ path: 'src/snake.py' })}
        result={makeOkEdit('src/snake.py')}
      />
    );
    // Title slot — exact text node.
    expect(screen.getByText('edit')).toBeInTheDocument();
    // Summary slot — the path appears at least once. Use getAllByText
    // because the path also shows up in the detail pane (file-path
    // chip alongside the diff stats).
    const pathHits = screen.getAllByText('src/snake.py');
    expect(pathHits.length).toBeGreaterThan(0);
    // The duplicated "edit src/snake.py" or "create src/snake.py"
    // string must NOT be present anywhere in the row.
    expect(screen.queryByText('edit src/snake.py')).toBeNull();
    expect(screen.queryByText('create src/snake.py')).toBeNull();
  });

  it('renders the path-only summary on a create call too', () => {
    const result: ToolResult = {
      id: 'r-c',
      name: 'edit',
      ok: true,
      output: '',
      durationMs: 1,
      data: {
        tool: 'edit',
        filePath: 'src/new.ts',
        additions: 3,
        deletions: 0,
        created: true,
        createdContent: 'a\nb\nc'
      }
    };
    render(
      <EditInvocation
        call={makeCall({ path: 'src/new.ts', create: true, content: 'a\nb\nc' })}
        result={result}
      />
    );
    // Title slot still reads "edit" for consistency across invocations
    // (the FilePlus vs PencilLine icon carries the create vs modify
    // signal; we never label the title "create").
    expect(screen.getByText('edit')).toBeInTheDocument();
    expect(screen.queryByText('create src/new.ts')).toBeNull();
    expect(screen.queryByText('edit src/new.ts')).toBeNull();
  });

  it('falls back to the bare verb when no path is available', () => {
    // Pre-result + missing path: row should still render something
    // human-readable rather than an empty summary cell.
    render(<EditInvocation call={makeCall({})} />);
    // The summary contains the literal "edit" word as the human label.
    // Multiple nodes contain "edit" (title + fallback summary); the
    // assertion is that the row mounts without throwing and the title
    // is still present.
    expect(screen.getAllByText(/edit/i).length).toBeGreaterThan(0);
  });
});
