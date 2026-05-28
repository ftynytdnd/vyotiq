/**
 * Live-streaming code diff auto-expand contract.
 *
 * Pins the user-facing visibility invariant: when the orchestrator's
 * `DiffStreamer` is emitting `diff-stream` events for an in-flight
 * `edit` call, the `ToolGroupRow` AND the inner `InvocationShell`
 * MUST both auto-expand so the user sees the live hunks without any
 * clicks. Once they manually toggle the row, the manual override
 * sticks and survives the partial → settled transition. On settle
 * without a manual override the row auto-collapses again so a long
 * multi-edit run doesn't leave the transcript permanently expanded.
 *
 * These behaviours mirror `SubAgentTrace`'s long-standing
 * auto-expand-while-running pattern; the test exists to keep them
 * from regressing back to the pre-fix "two clicks to see a streaming
 * diff" UX.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { ToolGroupRow } from '@renderer/components/timeline/rows/ToolGroupRow';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import type { ToolGroupChild } from '@renderer/components/timeline/reducer/deriveRows';
import type { DiffStreamSnapshot } from '@renderer/components/timeline/reducer/types';
import type { DiffHunk } from '@shared/types/tool';

const PATH = 'src/snake.py';
const HUNKS: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: ' ', text: 'context_before' },
      { kind: '-', text: 'old_line' },
      { kind: '+', text: 'STREAMING_NEW_LINE' },
      { kind: ' ', text: 'context_after' }
    ]
  }
];

function partialChild(overrides: Partial<ToolGroupChild> = {}): ToolGroupChild {
  const diffStream: DiffStreamSnapshot = {
    tool: 'edit',
    filePath: PATH,
    hunks: HUNKS,
    additions: 1,
    deletions: 1,
    settled: false,
    ts: 1
  };
  return {
    callId: 'c-live',
    call: {
      id: 'c-live',
      name: 'edit',
      args: { path: PATH, oldString: 'old_line', newString: 'STREAMING_NEW_LINE' }
    },
    partial: true,
    diffStream,
    ...overrides
  };
}

function settledChild(): ToolGroupChild {
  return {
    callId: 'c-live',
    call: {
      id: 'c-live',
      name: 'edit',
      args: { path: PATH, oldString: 'old_line', newString: 'STREAMING_NEW_LINE' }
    },
    result: {
      id: 'c-live',
      name: 'edit',
      ok: true,
      output: '',
      durationMs: 5,
      data: {
        tool: 'edit',
        filePath: PATH,
        additions: 1,
        deletions: 1,
        created: false,
        hunks: HUNKS
      }
    }
  };
}

beforeEach(() => {
  useChatStore.setState({ conversationId: 'c-test' });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
});

describe('live streaming diff — auto-expand', () => {
  it('auto-expands the tool-group row when a partial child carries a diffStream', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    // Top-level group button is the FIRST <button> in the tree; it
    // must report aria-expanded=true even though no one clicked it.
    const groupBtn = container.querySelector('button')!;
    expect(groupBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('reveals the streaming hunk content in the DOM with zero clicks', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    // The streaming + line carries a unique sentinel so we can detect
    // it specifically (not just any diff-related markup).
    expect(container.textContent ?? '').toContain('STREAMING_NEW_LINE');
    expect(container.textContent ?? '').toContain('old_line');
    // The data-variant on the diff container must be `partial` while
    // streaming so the cursor + softer intra-line stain land.
    const partialNode = container.querySelector('[data-variant="partial"]');
    expect(partialNode).not.toBeNull();
  });

  it('keeps the group collapsed when no partial child is in flight', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[settledChild()]} />
    );
    const groupBtn = container.querySelector('button')!;
    expect(groupBtn.getAttribute('aria-expanded')).toBe('false');
    // Hunk content is NOT visible in the DOM — the row needs an
    // explicit click to show the settled diff.
    expect(container.textContent ?? '').not.toContain('STREAMING_NEW_LINE');
  });

  it('records a manual override when the user collapses the auto-expanded row', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    const groupBtn = container.querySelector('button')!;
    expect(groupBtn.getAttribute('aria-expanded')).toBe('true');
    // Click toggles the VISIBLE state from true → false. The store
    // records a manual override + the explicit `false` value.
    fireEvent.click(groupBtn);
    const ui = useTimelineUiStore.getState();
    expect(ui.hasManualOverride('c-test', 'tg:c-live')).toBe(true);
    expect(ui.isExpanded('c-test', 'tg:c-live')).toBe(false);
    // Re-render reflects the override: aria-expanded now false even
    // though the partial child is still live.
    const groupBtnAfter = container.querySelector('button')!;
    expect(groupBtnAfter.getAttribute('aria-expanded')).toBe('false');
  });

  it('manual override survives the partial → settled transition (rowKey is stable)', () => {
    const { container, rerender } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    // Manual collapse during streaming.
    fireEvent.click(container.querySelector('button')!);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    // Settle the call. Same rowKey thanks to the
    // `appendSynthesizedPartialRows` unification — no `tg-partial:`
    // → `tg:` jump that would erase the override.
    rerender(<ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[settledChild()]} />);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('auto-collapses on settle when the user never overrode the auto-expanded row', () => {
    const { container, rerender } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    // Auto-expanded by the live signal; never clicked.
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    rerender(<ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[settledChild()]} />);
    // The live signal turned off; no override exists → derives back
    // to the persisted `false`. No write happens.
    const ui = useTimelineUiStore.getState();
    expect(ui.hasManualOverride('c-test', 'tg:c-live')).toBe(false);
    expect(ui.isExpanded('c-test', 'tg:c-live')).toBe(false);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('auto-expands in-flight edit after tool-call lands (call pending, no result)', () => {
    const child: ToolGroupChild = {
      callId: 'c-live',
      call: {
        id: 'c-live',
        name: 'edit',
        args: { path: PATH, oldString: 'old_line', newString: 'STREAMING_NEW_LINE' }
      }
    };
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[child]} />
    );
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent ?? '').toContain('STREAMING_NEW_LINE');
  });

  it('merges liveDiffByCallId into settled tool-group children via deriveRows', () => {
    const events = [
      { kind: 'user-prompt' as const, id: 'p1', ts: 1, content: 'go' },
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 2,
        call: {
          id: 'c-live',
          name: 'edit' as const,
          args: { path: PATH, oldString: 'old_line', newString: 'STREAMING_NEW_LINE' }
        }
      }
    ];
    const diffStream: DiffStreamSnapshot = {
      tool: 'edit',
      filePath: PATH,
      hunks: HUNKS,
      additions: 1,
      deletions: 1,
      settled: false,
      ts: 3
    };
    const rows = deriveRows(events, {
      liveDiffByCallId: { 'c-live': diffStream }
    });
    const group = rows.find((r) => r.kind === 'tool-group');
    expect(group?.kind === 'tool-group' && group.children[0]?.diffStream).toBeTruthy();
  });

  it('keeps the inner edit row open as well — both layers auto-expand together', async () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const innerBtn = buttons[1]!;
    expect(innerBtn.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      fireEvent.click(innerBtn);
    });
    const after = container.querySelectorAll('button');
    expect(after[0]!.getAttribute('aria-expanded')).toBe('true');
    expect(after[1]!.getAttribute('aria-expanded')).toBe('false');
  });
});
