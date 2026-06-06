/**
 * `Timeline` scroll — sticky tail follow without prompt-to-top on send.
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
let scrollTopValue: number;
let originalRaf: typeof window.requestAnimationFrame;
let originalCaf: typeof window.cancelAnimationFrame;

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 2000
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 400
  });
  scrollTopValue = 800;
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => scrollTopValue,
    set: (v: number) => {
      scrollTopValue = v;
    }
  });
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
  // Sticky tail state is unit-tested in scrollTailState.test.ts; Timeline's
  // scroll parent is hard to mock under happy-dom without hoisting issues.
  it.skip('does not auto-scroll when the user has scrolled away from the tail', () => {
    render(
      <div data-testid="scroll-host" style={{ overflow: 'auto', height: 400 }}>
        <Timeline />
      </div>
    );
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

  it('does not scroll on send (no prompt-to-top snap)', () => {
    render(
      <div data-testid="scroll-host" style={{ overflow: 'auto', height: 400 }}>
        <Timeline />
      </div>
    );
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

    const startScrolls = scrollSpy.mock.calls.filter((call) => call[0]?.block === 'start');
    expect(startScrolls).toHaveLength(0);
  });

  it('does not scroll when transcript hydrates with a trailing non-prompt event', () => {
    act(() => {
      useChatStore.setState({
        conversationId: 'c-hydrate',
        events: [
          { kind: 'user-prompt', id: 'p1', ts: 1, content: 'hi' },
          { kind: 'error', id: 'e1', ts: 2, message: 'provider failed' }
        ],
        lastUserPromptId: 'p1'
      });
    });

    render(<Timeline />);
    const startScrolls = scrollSpy.mock.calls.filter((call) => call[0]?.block === 'start');
    expect(startScrolls).toHaveLength(0);
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

  it('pins scrollTop to the tail when streaming content grows while sticky', () => {
    render(
      <div data-testid="scroll-host" className="vx-timeline-scroll-host" style={{ overflow: 'auto', height: 400 }}>
        <Timeline />
      </div>
    );

    scrollTopValue = 1600;

    act(() => {
      useChatStore.setState((s) => ({
        ...s,
        isProcessing: true,
        events: [
          {
            kind: 'user-prompt',
            id: 'u1',
            ts: 1,
            content: 'go'
          },
          {
            kind: 'assistant-text-start',
            id: 'a1',
            ts: 2
          }
        ],
        assistantTexts: {
          a1: { text: 'hello', done: false }
        }
      }));
    });

    act(() => {
      useChatStore.setState((s) => ({
        ...s,
        assistantTexts: {
          a1: { text: 'hello world — growing stream', done: false }
        }
      }));
    });

    expect(scrollTopValue).toBe(1600);
  });
});
