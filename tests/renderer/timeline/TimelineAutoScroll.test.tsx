/**
 * `Timeline` scroll — manual_only: no center-on-send snap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

function resetStore(): void {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    orchestratorUsage: undefined,
    runId: null,
    conversationId: null,
    isProcessing: false,
    runStartedAt: null
  });
}

let scrollSpy: ReturnType<typeof vi.fn>;
let originalRaf: typeof window.requestAnimationFrame;
let originalCaf: typeof window.cancelAnimationFrame;

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
  scrollSpy = vi.fn();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollSpy
  });

  originalRaf = window.requestAnimationFrame;
  originalCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 0;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetStore();
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
});

describe('Timeline auto-scroll', () => {
  it('does not center-on-send when a new user-prompt lands', () => {
    render(<Timeline />);
    scrollSpy.mockClear();

    const event: TimelineEvent = {
      kind: 'user-prompt',
      id: 'u-new',
      ts: Date.now(),
      content: 'hello agent'
    };

    act(() => {
      useChatStore.setState((s) => ({
        ...s,
        events: [...s.events, event],
        lastUserPromptId: event.id
      }));
    });

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('does not re-snap when the same user-prompt id is still the latest', () => {
    const event: TimelineEvent = {
      kind: 'user-prompt',
      id: 'u-stable',
      ts: Date.now(),
      content: 'still me'
    };
    act(() => {
      useChatStore.setState((s) => ({ ...s, events: [event], lastUserPromptId: event.id }));
    });

    render(<Timeline />);
    scrollSpy.mockClear();

    act(() => {
      useChatStore.setState((s) => ({ ...s, isProcessing: true }));
    });

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
