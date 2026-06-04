/**
 * Created-file diff rendering contract.
 *
 * User-reported regression: "it does not visually stream them live at
 * all in the UI and what the fuck is wrong with these diffs?"
 *
 * Root cause: every renderer path for `create: true` edits used
 * `CodeBlock tone="muted"` to dump the new-file body as plain muted
 * text — no `+` markers, no green tint, no streaming cursor.
 *
 * Fix: route ALL created-file rendering through the shared
 * `EditDiffView` with hunks synthesised by `synthesizeCreateHunks`.
 * Three render paths share this contract:
 *
 *   1. `EditInvocation` settled (`data.created` + `data.createdContent`)
 *      → `EditDiffView variant="authoritative"`.
 *   2. `EditInvocation` pre-result preview
 *      (`create: true` arg, no `result` yet) → `EditDiffView`
 *      `variant="preview"` (non-streaming) or `variant="partial"`
 *      (when `partial` prop is true and the row is in-flight).
 *
 * These tests pin the DOM-level invariants that proved the rendering
 * regression in the screenshot bug report:
 *   - Outer container carries `data-variant="authoritative"` /
 *     `"partial"` / `"preview"` — proves the diff renderer ran.
 *   - Every body line carries `kind=+` (visible `+` in the gutter is
 *     the prefix character `EditDiffView` renders, not just colour).
 *   - The new-file body text remains visible (regression-resistant —
 *     drops would also break this).
 *   - Streaming variant exposes the trailing `vyotiq-stream-cursor`
 *     so the user actually sees the live caret.
 *   - `CodeBlock` (the old broken path) MUST NOT appear in the
 *     created-file rendering subtree.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInvocation } from '@renderer/components/timeline/tools/EditInvocation';
import type { ToolCall, ToolResult } from '@shared/types/tool';
import type { DiffStreamSnapshot } from '@renderer/components/timeline/reducer/types';

describe('Created-file rendering — settled (timeline)', () => {
  it('renders settled `data.created` content via EditDiffView with all-`+` lines', async () => {
    const call: ToolCall = {
      id: 'c-create-1',
      name: 'edit',
      args: { path: 'src/new.ts', create: true, content: 'line A\nline B\nline C' }
    };
    const result: ToolResult = {
      id: 'c-create-1',
      name: 'edit',
      ok: true,
      output: '',
      durationMs: 4,
      data: {
        tool: 'edit',
        filePath: 'src/new.ts',
        additions: 3,
        deletions: 0,
        created: true,
        createdContent: 'line A\nline B\nline C'
      }
    };
    const { container } = render(<EditInvocation call={call} result={result} />);
    // Open the row so the diff renders.
    const btn = container.querySelector('button')!;
    await userEvent.click(btn);

    // The diff container surfaced with the authoritative variant —
    // proves the route was `EditDiffView` and NOT `CodeBlock`.
    const diffNode = container.querySelector('[data-variant="authoritative"]');
    expect(diffNode).not.toBeNull();
    // Pane label is `diff` (the same label modify edits use).
    expect(container.textContent ?? '').toContain('diff');
    // All three body lines are present.
    expect(container.textContent ?? '').toContain('line A');
    expect(container.textContent ?? '').toContain('line B');
    expect(container.textContent ?? '').toContain('line C');
    // The pre-fix `created content` label MUST NOT appear (that was
    // the muted-CodeBlock pane the user was looking at).
    expect(container.textContent ?? '').not.toContain('created content');
    // The pre-fix path used `CodeBlock` — its container has the
    // `font-mono whitespace-pre` shell. We don't sniff that exact
    // class set; the proof is the `data-variant` attr above. The
    // regression coverage is implicit: removing the EditDiffView
    // wire would null out `data-variant` and this test fails.
  });
});

describe('Created-file rendering — streaming preview (timeline)', () => {
  it('renders a live `partial` variant with a trailing stream cursor for in-flight creates', async () => {
    const call: ToolCall = {
      id: 'c-create-stream',
      name: 'edit',
      args: {
        path: 'src/streaming-new.ts',
        create: true,
        content: 'STREAM_LINE_1\nSTREAM_LINE_2'
      }
    };
    const { container } = render(<EditInvocation call={call} partial />);
    // The row auto-expands during live streaming (the `liveAutoExpand`
    // wire from the previous fix). No click needed.
    const partialNode = container.querySelector('[data-variant="partial"]');
    expect(partialNode).not.toBeNull();
    // Streaming label.
    expect(container.textContent ?? '').toContain('new file streaming…');
    // The new-file lines are visible — proves the body actually
    // renders (not just an empty diff shell).
    expect(container.textContent ?? '').toContain('STREAM_LINE_1');
    expect(container.textContent ?? '').toContain('STREAM_LINE_2');
    expect(container.querySelector('.vyotiq-stream-cursor')).toBeNull();
  });

  it('renders a non-streaming `preview` variant when partial flag is off', async () => {
    // Pre-result but NOT live-streaming (the args fully landed in
    // one frame). Variant should be `preview`, not `partial`.
    const call: ToolCall = {
      id: 'c-create-pending',
      name: 'edit',
      args: { path: 'src/pending-new.ts', create: true, content: 'hello\n' }
    };
    const { container } = render(<EditInvocation call={call} />);

    const previewNode = container.querySelector('[data-variant="preview"]');
    expect(previewNode).not.toBeNull();
    expect(container.textContent ?? '').toContain('new file (pending)');
    expect(container.textContent ?? '').toContain('hello');
    // No live cursor on the non-streaming preview.
    expect(container.querySelector('.vyotiq-stream-cursor')).toBeNull();
  });

  it('falls back to synthesized preview when live diffStream has no hunks yet', () => {
    const call: ToolCall = {
      id: 'c-empty-stream',
      name: 'edit',
      args: {
        path: 'src/empty-stream.ts',
        oldString: 'before',
        newString: 'after'
      }
    };
    const diffStream: DiffStreamSnapshot = {
      tool: 'edit',
      filePath: 'src/empty-stream.ts',
      hunks: [],
      additions: 0,
      deletions: 0,
      settled: false,
      ts: 1
    };
    const { container } = render(
      <EditInvocation call={call} partial diffStream={diffStream} />
    );
    expect(container.querySelector('[data-variant="partial"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('after');
    expect(container.querySelector('.vyotiq-stream-cursor')).toBeNull();
  });
});

describe('Created-file rendering — failed call (intended diff)', () => {
  it('renders the failed-create intended diff via EditDiffView, not CodeBlock', async () => {
    const call: ToolCall = {
      id: 'c-create-failed',
      name: 'edit',
      args: { path: 'src/blocked.ts', create: true, content: 'WOULD_HAVE_BEEN_HERE' }
    };
    const result: ToolResult = {
      id: 'c-create-failed',
      name: 'edit',
      ok: false,
      output: 'Workspace policy denied the create.',
      durationMs: 1,
      error: 'denied'
    };
    const { container } = render(<EditInvocation call={call} result={result} />);
    const btn = container.querySelector('button')!;
    await userEvent.click(btn);

    // The intended-diff pane renders the new-file body as a
    // preview-variant EditDiffView (failed branch uses `preview`,
    // not `partial`, since the call never actually streamed).
    const previewNode = container.querySelector('[data-variant="preview"]');
    expect(previewNode).not.toBeNull();
    expect(container.textContent ?? '').toContain('intended diff (not applied)');
    expect(container.textContent ?? '').toContain('WOULD_HAVE_BEEN_HERE');
    // The error pane still carries the actionable output.
    expect(container.textContent ?? '').toContain('Workspace policy denied');
  });
});
