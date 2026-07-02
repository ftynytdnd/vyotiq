/**
 * Turn zone ordering — live inline wire-order stream and completed summaries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';
import { AGENT_NAME } from '@shared/constants.js';

let originalScrollIntoView: typeof window.HTMLElement.prototype.scrollIntoView;
let originalRaf: typeof window.requestAnimationFrame;
let originalCaf: typeof window.cancelAnimationFrame;

function resetStore(): void {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    orchestratorUsage: undefined,
    runId: null,
    conversationId: null,
    isProcessing: false,
    runStartedAt: null,
    latestOrchestratorRunStatus: undefined
  });
}

beforeEach(() => {
  resetStore();
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
  resetStore();
});

describe('Timeline turn zones', () => {
  it('renders inline agent stream in wire order during a live turn', () => {
    useChatStore.setState({
      conversationId: 'c-zones',
      isProcessing: true,
      runStartedAt: 1000,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 1000, content: 'Run tools then answer' },
        { kind: 'tool-call', id: 'c1', ts: 1100, call: { id: 'call-1', name: 'read', args: { path: 'a.ts' } } },
        { kind: 'agent-text-delta', id: 'a1', ts: 1200, delta: 'Streaming answer.' }
      ] satisfies TimelineEvent[],
      assistantTexts: {
        a1: { id: 'a1', text: 'Streaming answer.', done: false, startedAt: Date.now() }
      },
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        id: 'rs1',
        ts: 1100,
        phase: 'running-tool',
        label: 'Running tool',
        detail: { toolName: 'read' }
      }
    });

    const { container } = render(<Timeline />);

    const weaveStream = container.querySelector('.vx-timeline-deleg-stream');
    const toolGroup = container.querySelector('[data-row-kind="tool-group"]');
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');

    expect(weaveStream ?? container.querySelector('.vx-timeline-agent-column')).not.toBeNull();
    expect(toolGroup).not.toBeNull();
    expect(assistant).not.toBeNull();
    expect(
      toolGroup!.compareDocumentPosition(assistant!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.textContent ?? '').not.toContain('Delegates');
  });

  it('renders assistant prose before tool groups when wire order has text first', () => {
    useChatStore.setState({
      conversationId: 'c-inline-order',
      isProcessing: true,
      runStartedAt: 1000,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 1, content: 'Summarize repo' },
        { kind: 'agent-text-delta', id: 'a1', ts: 2, delta: 'I will read key files next.' },
        {
          kind: 'tool-call',
          id: 'tc1',
          ts: 3,
          call: { id: 'c1', name: 'read', args: { path: 'README.md' } }
        }
      ] satisfies TimelineEvent[],
      assistantTexts: {
        a1: {
          id: 'a1',
          text: 'I will read key files next.',
          done: false,
          startedAt: Date.now()
        }
      },
      latestOrchestratorRunStatus: {
        kind: 'run-status',
        id: 'rs1',
        ts: 100,
        phase: 'running-tool',
        label: 'Running read…'
      }
    });

    const { container } = render(<Timeline />);

    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(assistant).not.toBeNull();
    expect(container.textContent ?? '').not.toContain('Delegates');
  });

  it('keeps a single live-status row in the activity lane and hides duplicate stream telemetry', () => {
    useChatStore.setState({
      conversationId: 'c-zones',
      isProcessing: true,
      runStartedAt: 1000,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 1000, content: 'Stream prose only' },
        { kind: 'agent-text-delta', id: 'a1', ts: 1100, delta: 'Hello' }
      ] satisfies TimelineEvent[],
      assistantTexts: {
        a1: { id: 'a1', text: 'Hello', done: false, startedAt: Date.now() }
      }
    });

    const { container } = render(<Timeline />);

    expect(container.querySelectorAll('[data-row-kind="live-status"]')).toHaveLength(0);
    // May 2026 restyle: visible AGENT_NAME eyebrow dropped \u2014 the
    // assistant prose row still mounts with the aria-label.
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(assistant).not.toBeNull();
    expect(assistant?.getAttribute('aria-label')).toBe(`${AGENT_NAME} response`);
    expect(container.textContent ?? '').not.toContain('Streaming response');
  });

  it('applies shared agent column; completed prose keeps response surface', () => {
    useChatStore.setState({
      conversationId: 'c-zones',
      isProcessing: false,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 100, content: 'Hi' },
        { kind: 'agent-text-delta', id: 'a1', ts: 200, delta: 'Done.' },
        { kind: 'agent-text-end', id: 'a1', ts: 201 }
      ] satisfies TimelineEvent[],
      assistantTexts: {
        a1: { id: 'a1', text: 'Done.', done: true }
      }
    });

    const { container } = render(<Timeline />);

    const agentColumn = container.querySelector('.vx-timeline-agent-column');
    expect(agentColumn).not.toBeNull();
    expect(agentColumn?.className ?? '').toContain('vx-timeline-agent-column');

    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(assistant).not.toBeNull();
    expect(assistant?.closest('.vx-timeline-agent-column')).not.toBeNull();
    expect(container.querySelector('[data-turn-activity-summary]')).toBeNull();
  });

  it('appends partial tool rows at the inline stream tail during a live turn', () => {
    useChatStore.setState({
      conversationId: 'c-zones',
      isProcessing: true,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
        { kind: 'agent-text-delta', id: 'a1', ts: 2, delta: 'Answer.' }
      ] satisfies TimelineEvent[],
      assistantTexts: {
        a1: { id: 'a1', text: 'Answer.', done: false, startedAt: Date.now() }
      },
      partialToolCallArgs: {
        partial1: {
          callId: 'partial1',
          name: 'read',
          index: 0,
          argsBuf: '{"path":"src/a.ts"}',
          parsed: { path: 'src/a.ts' },
          ts: 4
        }
      }
    });

    const { container } = render(<Timeline />);

    const toolGroup = container.querySelector('[data-row-kind="tool-group"]');
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(toolGroup).not.toBeNull();
    expect(assistant).not.toBeNull();
    expect(
      assistant!.compareDocumentPosition(toolGroup!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders completed turn rows in the inline agent column', () => {
    useChatStore.setState({
      conversationId: 'c-zones',
      isProcessing: false,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 100, content: 'Use tools' },
        { kind: 'tool-call', id: 'c1', ts: 110, call: { id: 'call-1', name: 'read', args: { path: 'a.ts' } } },
        { kind: 'agent-text-delta', id: 'a1', ts: 130, delta: 'Done.' },
        { kind: 'agent-text-end', id: 'a1', ts: 131 },
        { kind: 'user-prompt', id: 'p2', ts: 5000, content: 'Next turn' },
        { kind: 'agent-text-delta', id: 'a2', ts: 5100, delta: 'Ok.' },
        { kind: 'agent-text-end', id: 'a2', ts: 5101 }
      ] satisfies TimelineEvent[],
      assistantTexts: {
        a1: { id: 'a1', text: 'Done.', done: true },
        a2: { id: 'a2', text: 'Ok.', done: true }
      }
    });

    const { container } = render(<Timeline />);

    expect(container.querySelector('.vx-timeline-deleg-stream')).toBeNull();
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(assistant).not.toBeNull();
    expect(assistant?.closest('.vx-timeline-agent-column')).not.toBeNull();
  });

  it('shows run-complete when the run fully ends on the trailing turn', () => {
    act(() => {
      useChatStore.setState({
        conversationId: 'c-zones',
        isProcessing: true,
        awaitingAskUser: false,
        latestOrchestratorRunStatus: undefined,
        events: [
          { kind: 'user-prompt', id: 'p1', ts: 1000, content: 'Go' },
          { kind: 'agent-text-delta', id: 'a1', ts: 2000, delta: 'Done.' },
          { kind: 'agent-text-end', id: 'a1', ts: 2100 }
        ] satisfies TimelineEvent[],
        assistantTexts: {
          a1: { id: 'a1', text: 'Done.', done: true }
        }
      });
    });

    const { container, rerender } = render(<Timeline />);
    expect(container.querySelector('[data-row-kind="run-complete"]')).toBeNull();
    expect(container.querySelector('[data-turn-sticky-footer]')).not.toBeNull();

    act(() => {
      useChatStore.setState({ isProcessing: false, awaitingAskUser: false });
    });
    rerender(<Timeline />);
    expect(container.querySelector('.vx-turn-sticky-footer__live')).toBeNull();
    expect(container.querySelector('[data-row-kind="run-complete"]')).not.toBeNull();
  });

  it('suppresses run-complete while paused for ask_user', () => {
    act(() => {
      useChatStore.setState({
        conversationId: 'c-zones',
        isProcessing: true,
        awaitingAskUser: false,
        runId: 'run-ask',
        events: [
          { kind: 'user-prompt', id: 'p1', ts: 1000, content: 'Go' },
          {
            kind: 'ask-user-prompt',
            id: 'ask-1',
            ts: 2000,
            status: 'pending',
            displayText: 'Which file?',
            toolCallId: 'tc-ask',
            runId: 'run-ask',
            payload: {
              questions: [
                {
                  id: 'q1',
                  prompt: 'Which file?',
                  options: [{ id: 'a', label: 'src/index.ts' }]
                }
              ]
            }
          }
        ] satisfies TimelineEvent[]
      });
    });

    const { container, rerender } = render(<Timeline />);
    expect(container.querySelector('[data-row-kind="run-complete"]')).toBeNull();

    act(() => {
      useChatStore.setState({ isProcessing: false, awaitingAskUser: true });
    });
    rerender(<Timeline />);

    expect(container.querySelector('[data-row-kind="run-complete"]')).toBeNull();
    expect(container.querySelector('.vx-turn-sticky-footer__live')).not.toBeNull();
    expect(container.querySelector('.vx-turn-sticky-footer__live')?.textContent).toContain(
      'Awaiting your answer'
    );
  });
});
