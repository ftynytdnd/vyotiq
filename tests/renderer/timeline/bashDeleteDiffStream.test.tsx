/**
 * Bash + Delete renderer parity with `EditInvocation` for the FS-aware
 * live diff stream (Phase 2). Pins:
 *
 *   1. `BashInvocation` paints the streaming write hunks under a
 *      `streaming write` pane when the call is in-flight AND the
 *      `bashWriteParser` produced a `diffStream` snapshot tagged
 *      `tool: 'bash'`.
 *   2. `DeleteInvocation` paints the streaming removal hunks under a
 *      `streaming removal` pane when the call is in-flight AND the
 *      `DiffStreamer` produced a `diffStream` tagged `tool: 'delete'`.
 *   3. Both renderers auto-expand the `InvocationShell` while the
 *      stream is live, mirroring `EditInvocation`'s `liveAutoExpand`.
 *   4. The streaming pane disappears once the call settles
 *      (`partial: false` AND `result` arrives); the authoritative
 *      stdout/stderr/exit (bash) or `-N deletedLines` row (delete)
 *      takes over.
 *
 * Pre-fix, `ToolInvocation` forwarded `diffStream` to both renderers
 * but neither component declared the prop, so the live diff was
 * silently dropped. These regressions would not be caught by any
 * existing test before this file landed.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BashInvocation } from '@renderer/components/timeline/tools/BashInvocation';
import { DeleteInvocation } from '@renderer/components/timeline/tools/DeleteInvocation';
import type { ToolCall, ToolResult, DiffHunk } from '@shared/types/tool';
import type { DiffStreamSnapshot } from '@renderer/components/timeline/reducer/types';

const HUNKS: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: '-', text: 'OLD_BASH_LINE' },
      { kind: '+', text: 'NEW_BASH_LINE' }
    ]
  }
];

describe('BashInvocation — streaming write diff', () => {
  it('renders the streaming write pane when partial + bash diffStream are present', () => {
    const call: ToolCall = {
      id: 'b1',
      name: 'bash',
      args: { command: `cat > a.ts << EOF\nNEW_BASH_LINE\nEOF` }
    };
    const diffStream: DiffStreamSnapshot = {
      tool: 'bash',
      filePath: 'a.ts',
      hunks: HUNKS,
      additions: 1,
      deletions: 1,
      settled: false,
      ts: 1
    };
    const { container } = render(
      <BashInvocation
        call={call}
        partial
        diffStream={diffStream}
        rowKey="inv:b1"
      />
    );
    // Auto-expanded by `liveAutoExpand`, so the pane is visible.
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    // The streaming label and the unique sentinel line both land in
    // the DOM without any clicks.
    expect(container.textContent ?? '').toContain('streaming write');
    expect(container.textContent ?? '').toContain('NEW_BASH_LINE');
    expect(container.textContent ?? '').toContain('OLD_BASH_LINE');
    // `data-variant="partial"` proves the streaming-tip cursor is on.
    expect(container.querySelector('[data-variant="partial"]')).not.toBeNull();
  });

  it('drops the streaming pane once the call settles (result arrives)', () => {
    const call: ToolCall = {
      id: 'b1',
      name: 'bash',
      args: { command: `cat > a.ts << EOF\nNEW_BASH_LINE\nEOF` }
    };
    const result: ToolResult = {
      id: 'b1',
      name: 'bash',
      ok: true,
      output: '',
      durationMs: 5,
      data: {
        tool: 'bash',
        command: call.args['command'] as string,
        stdout: '',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false
      }
    };
    const { container } = render(
      <BashInvocation call={call} result={result} rowKey="inv:b1" />
    );
    // No `partial`, no `diffStream` → no streaming pane.
    expect(container.textContent ?? '').not.toContain('streaming write');
    expect(container.querySelector('[data-variant="partial"]')).toBeNull();
  });

  it('ignores a non-bash diffStream (defensive — wrong tool tag)', () => {
    const call: ToolCall = {
      id: 'b1',
      name: 'bash',
      args: { command: `ls -la` }
    };
    const wrong: DiffStreamSnapshot = {
      tool: 'edit',
      filePath: 'a.ts',
      hunks: HUNKS,
      additions: 1,
      deletions: 1,
      settled: false,
      ts: 1
    };
    const { container } = render(
      <BashInvocation
        call={call}
        partial
        diffStream={wrong}
        rowKey="inv:b1"
      />
    );
    expect(container.textContent ?? '').not.toContain('streaming write');
  });
});

describe('DeleteInvocation — streaming removal diff', () => {
  it('renders the streaming removal pane when partial + delete diffStream are present', () => {
    const call: ToolCall = {
      id: 'd1',
      name: 'delete',
      args: { path: 'doomed.txt' }
    };
    const diffStream: DiffStreamSnapshot = {
      tool: 'delete',
      filePath: 'doomed.txt',
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: '-', text: 'BYE_LINE_1' },
            { kind: '-', text: 'BYE_LINE_2' }
          ]
        }
      ],
      additions: 0,
      deletions: 2,
      settled: false,
      ts: 1
    };
    const { container } = render(
      <DeleteInvocation
        call={call}
        partial
        diffStream={diffStream}
        rowKey="inv:d1"
      />
    );
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent ?? '').toContain('streaming removal');
    expect(container.textContent ?? '').toContain('BYE_LINE_1');
    expect(container.textContent ?? '').toContain('BYE_LINE_2');
    expect(container.querySelector('[data-variant="partial"]')).not.toBeNull();
  });

  it('hides the streaming pane once the result arrives — settled deletedLines is enough', () => {
    const call: ToolCall = {
      id: 'd1',
      name: 'delete',
      args: { path: 'doomed.txt' }
    };
    const result: ToolResult = {
      id: 'd1',
      name: 'delete',
      ok: true,
      output: '',
      durationMs: 2,
      data: {
        tool: 'delete',
        filePath: 'doomed.txt',
        deletedLines: 2
      }
    };
    const { container } = render(
      <DeleteInvocation call={call} result={result} rowKey="inv:d1" />
    );
    // The streaming pane MUST be gone the moment a settled result
    // arrives — the authoritative `data.deletedLines` row inside
    // the (collapsed) detail pane carries the post-execution count.
    expect(container.textContent ?? '').not.toContain('streaming removal');
    expect(container.querySelector('[data-variant="partial"]')).toBeNull();
    // The settled row stays collapsed by default (no live signal),
    // so its inner aria-expanded reads false.
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });
});
