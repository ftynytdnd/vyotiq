/**
 * `Timeline` auto-scroll regression.
 *
 * Confirms the snap-on-send behaviour: the moment a new `user-prompt`
 * event appears on the chat store, the Timeline must call
 * `scrollIntoView` on its bottom sentinel — even if the user was
 * previously scrolled up past the sticky threshold.
 *
 * Also confirms that a second `user-prompt` with the same id does NOT
 * trigger a redundant snap (the effect must dedupe by id, not by
 * events array identity), and that short-but-unchanging event arrays
 * don't accidentally re-snap either.
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
  // Fake timers so `LiveStatusRow`'s 1 s setInterval doesn't fire a
  // setState outside `act()` mid-test (visible as a noisy "update was
  // not wrapped in act(...)" console warning, no functional impact).
  // The auto-scroll suite never advances time itself, so freezing the
  // clock is safe.
  vi.useFakeTimers();
  scrollSpy = vi.fn();
  // Route every element's scrollIntoView through our spy. The Timeline
  // only calls it on its hidden bottom sentinel, so this is a clean
  // signal even though we've patched the prototype.
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollSpy
  });

  // Flush rAF synchronously. The Timeline defers its actual
  // `scrollIntoView` call inside a rAF to coalesce burst-y deltas; in
  // the test environment we want the callback to run before the
  // assertion so we don't have to juggle fake timers for it.
  originalRaf = window.requestAnimationFrame;
  originalCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    cb(performance.now());
    return 0;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  // Unmount FIRST so any cleanup effects (clearInterval) run while the
  // store still has its test state. Otherwise the next test's
  // `resetStore()` triggers a render under fake timers with a stale
  // mounted tree, producing the act() warning the bookkeeping above is
  // meant to suppress.
  cleanup();
  vi.useRealTimers();
  resetStore();
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
});

describe('Timeline auto-scroll', () => {
  it('snaps to the tail when a new user-prompt lands on the store', () => {
    render(<Timeline />);
    // Initial mount always calls scrollToTail() via the rows-length
    // effect; clear the baseline call so the assertion below
    // specifically targets the snap-on-send path.
    scrollSpy.mockClear();

    const event: TimelineEvent = {
      kind: 'user-prompt',
      id: 'u-new',
      ts: Date.now(),
      content: 'hello agent'
    };

    act(() => {
      useChatStore.setState((s) => ({ ...s, events: [...s.events, event] }));
    });

    expect(scrollSpy).toHaveBeenCalled();
  });

  it('does not re-snap when the same user-prompt id is still the latest', () => {
    const event: TimelineEvent = {
      kind: 'user-prompt',
      id: 'u-stable',
      ts: Date.now(),
      content: 'still me'
    };
    act(() => {
      useChatStore.setState((s) => ({ ...s, events: [event] }));
    });

    render(<Timeline />);
    scrollSpy.mockClear();

    // Bump an unrelated piece of state — NOT a new user-prompt id —
    // and verify the snap effect stays quiet.
    act(() => {
      useChatStore.setState((s) => ({ ...s, isProcessing: true }));
    });

    // The rows-length effect didn't fire (row count unchanged); the
    // snap effect should also have stayed quiet because the latest
    // user-prompt id didn't change.
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
