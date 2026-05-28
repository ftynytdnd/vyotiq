/**
 * Timeline inline column alignment — shared agent rail, flat activity lane,
 * delegation status ordering, and jump-chip gutter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';
import { timelineAgentColumnReserveRightClassName } from '@renderer/components/timeline/shared/rowStyles';

let originalScrollIntoView: typeof window.HTMLElement.prototype.scrollIntoView;
let originalRaf: typeof window.requestAnimationFrame;
let originalCaf: typeof window.cancelAnimationFrame;

beforeEach(() => {
  vi.useFakeTimers();
  originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
  originalRaf = window.requestAnimationFrame;
  originalCaf = window.cancelAnimationFrame;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 0;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: null,
    isProcessing: false
  });
});

function seedDelegationTurn(withResponse = false) {
  const events: TimelineEvent[] = [
    { kind: 'user-prompt', id: 'p1', ts: 1, content: 'Analyze the codebase' },
    {
      kind: 'subagent-pending',
      id: 'sp1',
      ts: 2,
      subagentId: 'A1',
      task: 'Analyze entry point',
      files: [],
      tools: ['read']
    },
    {
      kind: 'subagent-spawn',
      id: 'ss1',
      ts: 3,
      subagentId: 'A1',
      task: 'Analyze entry point',
      files: [],
      tools: ['read']
    }
  ];

  if (withResponse) {
    events.push({ kind: 'agent-text-delta', id: 'a1', ts: 4, delta: 'Phase 1 plan.' });
  }

  useChatStore.setState({
    conversationId: 'c-align',
    isProcessing: true,
    runStartedAt: Date.now(),
    events,
    subagents: {
      A1: {
        id: 'A1',
        task: 'Analyze entry point',
        files: [],
        missingFiles: [],
        tools: ['read'],
        unknownTools: [],
        status: 'running',
        startedAt: 1,
        steps: [],
        fileEdits: [],
        assistantTexts: {},
        reasoningTexts: {},
        iterationOrder: [],
        partialToolCallArgs: {}
      }
    },
    latestOrchestratorRunStatus: {
      kind: 'run-status',
      id: 'rs1',
      ts: 100,
      phase: 'delegating',
      label: 'Delegating 5 sub-tasks…'
    },
    ...(withResponse
      ? {
        assistantTexts: {
          a1: { id: 'a1', text: 'Phase 1 plan.', done: false, startedAt: Date.now() }
        }
      }
      : {})
  });
}

describe('Timeline inline column alignment', () => {
  it('uses a flat activity lane inside a single pl-3.5 agent column', () => {
    seedDelegationTurn(true);

    const { container } = render(<Timeline />);

    const agentColumn = container.querySelector('.timeline-agent-column');
    const activityLane = container.querySelector('.timeline-activity-lane');

    expect(agentColumn).not.toBeNull();
    expect(agentColumn?.className ?? '').toContain('pl-3.5');
    expect(activityLane).not.toBeNull();
    expect(activityLane?.className ?? '').not.toMatch(/\bborder-l\b/);
    expect(activityLane?.className ?? '').not.toMatch(/\bpl-3\b/);
  });

  it('uses inline wire-order stream during live delegation (no category eyebrows)', () => {
    seedDelegationTurn(true);

    const { container } = render(<Timeline />);

    const inlineStream = container.querySelector('[data-turn-inline-stream]');
    // May 2026 restyle: the visible AGENT_NAME eyebrow on the assistant
    // prose row was removed in favor of an aria-label on the row root.
    // Pin the structural contract instead — the assistant-text row
    // must still live inside the inline wire-order stream.
    const assistantRow = container.querySelector('[data-row-kind="assistant-text"]');

    expect(inlineStream).not.toBeNull();
    expect(assistantRow).not.toBeNull();
    expect(assistantRow?.closest('[data-turn-inline-stream]')).not.toBeNull();
    expect(container.textContent ?? '').not.toContain('Delegates');
  });

  it('renders delegating live status at the inline stream tail', () => {
    seedDelegationTurn(false);

    const { container } = render(<Timeline />);

    const inlineStream = container.querySelector('[data-turn-inline-stream]');
    const liveStatus = container.querySelector('[data-row-kind="live-status"]');
    const firstSubagent = container.querySelector('[data-row-kind="subagent-line"]');

    expect(inlineStream).not.toBeNull();
    expect(liveStatus).not.toBeNull();
    expect(firstSubagent).not.toBeNull();
    expect(inlineStream?.contains(liveStatus)).toBe(true);
    expect(
      firstSubagent!.compareDocumentPosition(liveStatus!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('does not add a response separator during live inline streaming', () => {
    seedDelegationTurn(true);

    const { container } = render(<Timeline />);

    const inlineStream = container.querySelector('[data-turn-inline-stream]');
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');

    expect(inlineStream?.contains(assistant)).toBe(true);
    expect(container.querySelector('.border-t.border-border-subtle\\/15')).toBeNull();
  });

  it('pairs the jump chip with a reserved right gutter class', () => {
    expect(timelineAgentColumnReserveRightClassName).toBe('pr-[5.5rem]');
  });
});
