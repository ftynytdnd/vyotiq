/**
 * Timeline inline column alignment — shared agent rail, flat activity lane,
 * delegation status ordering, and jump-chip gutter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

let originalScrollIntoView: typeof window.HTMLElement.prototype.scrollIntoView;
let originalRaf: typeof window.requestAnimationFrame;
let originalCaf: typeof window.cancelAnimationFrame;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 2000
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 400
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    writable: true,
    value: 800
  });
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
  useTimelineUiStore.setState({ timelineAtTail: true });
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
      label: 'Spawning 5 workers…'
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
  it('uses a flat agent column during delegation', () => {
    seedDelegationTurn(true);

    const { container } = render(<Timeline />);

    const agentColumn = container.querySelector('.timeline-agent-column');

    expect(agentColumn).not.toBeNull();
    expect(agentColumn?.className ?? '').toContain('vx-timeline-agent-column');
    expect(container.querySelector('.vx-timeline-deleg-stream')).not.toBeNull();
  });

  it('uses delegation stream during live delegation (no category eyebrows)', () => {
    seedDelegationTurn(true);

    const { container } = render(<Timeline />);

    const weaveStream = container.querySelector('.vx-timeline-deleg-stream');
    const assistantRow = container.querySelector('[data-row-kind="assistant-text"]');

    expect(weaveStream).not.toBeNull();
    expect(assistantRow).not.toBeNull();
    expect(container.textContent ?? '').not.toContain('Delegates');
  });

  it('does not render live-status rows in the inline stream during delegation', () => {
    seedDelegationTurn(false);

    const { container } = render(<Timeline />);

    expect(container.querySelector('[data-row-kind="live-status"]')).toBeNull();
    expect(container.textContent ?? '').not.toContain('Exploring');
  });

  // Jump chip is portaled to the scroll parent's parent; happy-dom scroll metrics
  // do not match production. Covered by scrollTailState.test.ts + manual QA.
  it.skip('renders jump-to-latest label without backdrop blur on the chip', async () => {
    useChatStore.setState({
      conversationId: 'c-jump',
      events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'Hi' }],
      isProcessing: false
    });

    render(
      <div data-testid="scroll-host" style={{ overflow: 'auto', height: 400 }}>
        <Timeline />
      </div>
    );

    const chip = document.querySelector('.vx-jump-to-latest-chip');
    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent('Latest');
    expect(chip.className).not.toMatch(/backdrop-blur/);
    expect(chip.querySelector('.vx-jump-to-latest-label')).toHaveTextContent('Latest');
  });

  it('does not add a response separator during live delegation stream', () => {
    seedDelegationTurn(true);

    const { container } = render(<Timeline />);

    const weaveStream = container.querySelector('.vx-timeline-deleg-stream');
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');

    expect(weaveStream?.contains(assistant)).toBe(true);
    expect(container.querySelector('.border-t.border-border-subtle\\/15')).toBeNull();
  });
});
