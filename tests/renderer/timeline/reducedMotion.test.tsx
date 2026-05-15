/**
 * `prefers-reduced-motion: reduce` must not strip the shimmer classes
 * from the DOM — the visual effect is suppressed in CSS (the @media
 * block in `index.css` freezes animation and paints a static accent
 * tint). Keeping the markup deterministic regardless of motion
 * preference matches the rest of the app's accessibility model and
 * preserves snapshot parity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ReasoningLineRow } from '@renderer/components/timeline/rows/ReasoningLineRow';
import { useChatStore } from '@renderer/store/useChatStore';

type MatchMediaFn = (query: string) => MediaQueryList;

function stubMatchMedia(reduce: boolean): void {
  const fn: MatchMediaFn = (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true)
  } as unknown as MediaQueryList);
  Object.defineProperty(window, 'matchMedia', {
    value: fn,
    configurable: true,
    writable: true
  });
}

const originalMatchMedia = window.matchMedia;

beforeEach(async () => {
  stubMatchMedia(true);
  await act(async () => {
    useChatStore.setState({
      reasoningTexts: {
        r1: { id: 'r1', text: 'still thinking', done: false, startedAt: Date.now() }
      }
    });
  });
});

afterEach(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      value: originalMatchMedia,
      configurable: true,
      writable: true
    });
  }
});

describe('Shimmer under prefers-reduced-motion', () => {
  it('keeps shimmer classes on the DOM so CSS can take over', () => {
    const { container } = render(<ReasoningLineRow id="r1" />);
    // Classes must still be present — the @media block in index.css
    // is responsible for halting animation and applying a static tint.
    expect(container.innerHTML).toContain('vyotiq-shimmer-text');
  });
});
