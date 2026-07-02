/**
 * Live-streaming code diff auto-expand contract.
 *
 * When the orchestrator's `DiffStreamer` is emitting `diff-stream`
 * events for an in-flight `edit` call, the `ToolGroupRow` AND the
 * inner `InvocationShell` MUST both auto-expand so the user sees the
 * live hunks without any clicks. Once they manually toggle the row,
 * the manual override sticks and survives the partial → settled
 * transition. On settle without a manual override the row
 * auto-collapses again.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { ToolGroupRow } from '@renderer/components/timeline/rows/ToolGroupRow';
import { deriveDisplayRows } from '@renderer/components/timeline/reducer/deriveRows';
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
    const groupBtn = container.querySelector('button')!;
    expect(groupBtn.getAttribute('aria-expanded')).toBe('true');
  });

  it('reveals streaming hunk content without a click', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    expect(container.textContent ?? '').toContain('STREAMING_NEW_LINE');
  });

  it('keeps the group collapsed when no partial child is in flight', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[settledChild()]} />
    );
    const groupBtn = container.querySelector('button')!;
    expect(groupBtn.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent ?? '').not.toContain('STREAMING_NEW_LINE');
  });

  it('records a manual override when the user expands then collapses the row', () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    const groupBtn = container.querySelector('button')!;
    expect(groupBtn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(groupBtn);
    expect(groupBtn.getAttribute('aria-expanded')).toBe('false');
    const ui = useTimelineUiStore.getState();
    expect(ui.hasManualOverride('c-test', 'tg:c-live')).toBe(true);
    expect(ui.isExpanded('c-test', 'tg:c-live')).toBe(false);
    const groupBtnAfter = container.querySelector('button')!;
    expect(groupBtnAfter.getAttribute('aria-expanded')).toBe('false');
  });

  it('manual override survives the partial → settled transition (rowKey is stable)', () => {
    const { container, rerender } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    fireEvent.click(container.querySelector('button')!);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    rerender(<ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[settledChild()]} />);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('auto-collapses on settle when the user never toggled the row', () => {
    const { container, rerender } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
    rerender(<ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[settledChild()]} />);
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
  });

  it('merges liveDiffByCallId into root-level streaming file-edit cards via deriveRows', () => {
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
    const rows = deriveDisplayRows(events, {
      liveDiffByCallId: { 'c-live': diffStream }
    });
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card?.kind).toBe('file-edit-card');
    if (card?.kind !== 'file-edit-card') return;
    expect(card.callId).toBe('c-live');
    expect(card.hunks).toEqual(HUNKS);
    expect(card.phase).toBe('streaming');
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'edit')).toBe(false);
  });

  it('collapses when the user clicks the header during streaming', async () => {
    const { container } = render(
      <ToolGroupRow rowKey="tg:c-live" toolName="edit" items={[partialChild()]} />
    );
    const groupBtn = container.querySelector('button')!;
    expect(groupBtn.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      fireEvent.click(groupBtn);
    });
    expect(groupBtn.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent ?? '').not.toContain('STREAMING_NEW_LINE');
  });
});
