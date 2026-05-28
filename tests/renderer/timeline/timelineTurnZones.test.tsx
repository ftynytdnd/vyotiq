/**
 * Turn zone ordering — live inline wire-order stream and completed summaries.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';
import { AGENT_NAME } from '@shared/constants.js';

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

    const inlineStream = container.querySelector('[data-turn-inline-stream]');
    const toolGroup = container.querySelector('[data-row-kind="tool-group"]');
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');

    expect(inlineStream).not.toBeNull();
    expect(toolGroup).not.toBeNull();
    expect(assistant).not.toBeNull();
    expect(
      toolGroup!.compareDocumentPosition(assistant!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.textContent ?? '').not.toContain('Delegates');
  });

  it('renders assistant prose before delegate batch when wire order has text first', () => {
    useChatStore.setState({
      conversationId: 'c-inline-order',
      isProcessing: true,
      runStartedAt: 1000,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 1, content: 'Summarize repo' },
        { kind: 'agent-text-delta', id: 'a1', ts: 2, delta: 'I will delegate parallel sub-agents.' },
        {
          kind: 'subagent-pending',
          id: 'sp1',
          ts: 3,
          subagentId: 'A1',
          task: 'Summarize core',
          files: [],
          tools: ['read']
        },
        {
          kind: 'subagent-spawn',
          id: 'ss1',
          ts: 4,
          subagentId: 'A1',
          task: 'Summarize core',
          files: [],
          tools: ['read']
        },
        {
          kind: 'subagent-pending',
          id: 'sp2',
          ts: 5,
          subagentId: 'A2',
          task: 'Audit tools',
          files: [],
          tools: ['read']
        },
        {
          kind: 'subagent-spawn',
          id: 'ss2',
          ts: 6,
          subagentId: 'A2',
          task: 'Audit tools',
          files: [],
          tools: ['read']
        }
      ] satisfies TimelineEvent[],
      assistantTexts: {
        a1: {
          id: 'a1',
          text: 'I will delegate parallel sub-agents.',
          done: false,
          startedAt: Date.now()
        }
      },
      subagents: {
        A1: {
          id: 'A1',
          task: 'Summarize core',
          files: [],
          missingFiles: [],
          tools: ['read'],
          status: 'running',
          startedAt: 1,
          steps: [],
          fileEdits: [],
          assistantTexts: {},
          reasoningTexts: {},
          iterationOrder: [],
          partialToolCallArgs: {}
        },
        A2: {
          id: 'A2',
          task: 'Audit tools',
          files: [],
          missingFiles: [],
          tools: ['read'],
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
        label: 'Delegating 2 sub-tasks…'
      }
    });

    const { container } = render(<Timeline />);

    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    const delegateBatch = container.querySelector('[data-row-kind="delegate-batch"]');
    const inlineStream = container.querySelector('[data-turn-inline-stream]');

    expect(inlineStream).not.toBeNull();
    expect(assistant).not.toBeNull();
    expect(delegateBatch).not.toBeNull();
    expect(
      assistant!.compareDocumentPosition(delegateBatch!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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

    const agentColumn = container.querySelector('.timeline-agent-column');
    expect(agentColumn).not.toBeNull();
    expect(agentColumn?.className ?? '').toContain('vx-timeline-agent-column');

    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(assistant).not.toBeNull();
    expect(assistant?.closest('.timeline-agent-column')).not.toBeNull();
    expect(container.querySelector('[data-row-kind="turn-activity-summary"]')).toBeNull();
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

  it('renders completed turn rows without the live inline stream wrapper', () => {
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

    expect(container.querySelector('[data-turn-inline-stream]')).toBeNull();
    const assistant = container.querySelector('[data-row-kind="assistant-text"]');
    expect(assistant).not.toBeNull();
    expect(assistant?.closest('[data-turn-inline-stream]')).toBeNull();
  });
});
