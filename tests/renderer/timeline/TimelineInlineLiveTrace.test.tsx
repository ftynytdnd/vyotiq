/**
 * Timeline inline stream — live status moved to composer strip (not inline).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

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

  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: 'c-inline-live',
    isProcessing: true,
    runStartedAt: 1000,
    latestOrchestratorRunStatus: {
      kind: 'run-status',
      id: 'rs-live',
      ts: Date.now(),
      phase: 'running-tool',
      label: 'Running tool',
      detail: { toolName: 'read' }
    },
    events: [
      {
        kind: 'user-prompt',
        id: 'p-live',
        ts: 1000,
        content: 'Analyze the screenshot and stream tool progress'
      }
    ] satisfies TimelineEvent[]
  });
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
    isProcessing: false,
    runStartedAt: null
  });
});

describe('Timeline inline live trace', () => {
  it('does not mount live-status rows in the timeline (composer strip owns live phase)', () => {
    const { container } = render(<Timeline />);

    const prompt = container.querySelector('[data-row-kind="user-prompt"]');
    const liveRows = container.querySelectorAll('[data-row-kind="live-status"]');

    expect(prompt).not.toBeNull();
    expect(liveRows).toHaveLength(0);
    expect(container.querySelector('.vx-timeline-user-bubble')).not.toBeNull();
  });
});
