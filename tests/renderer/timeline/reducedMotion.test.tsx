/**
 * `prefers-reduced-motion: reduce` must keep live phase heading markup
 * stable — gold phase labels use static text color (no shimmer animation),
 * and `vyotiq-reveal-text` is suppressed in CSS under reduced motion.
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

describe('Live phase headings under prefers-reduced-motion', () => {
  it('keeps gold phase heading classes on the DOM', () => {
    const { container } = render(<ReasoningLineRow id="r1" />);
    expect(container.innerHTML).toContain('text-accent-gold');
    expect(container.innerHTML).not.toContain('vyotiq-shimmer-text');
  });
});
