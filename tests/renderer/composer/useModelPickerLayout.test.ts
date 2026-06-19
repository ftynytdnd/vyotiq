import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useModelPickerLayout } from '@renderer/components/composer/modelPicker/useModelPickerLayout';
import { MODEL_PICKER_SPLIT_MIN_PX } from '@renderer/components/composer/modelPicker/modelPickerLayout';

class MockResizeObserver {
  static last: MockResizeObserver | null = null;
  private cb: ResizeObserverCallback;

  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    MockResizeObserver.last = this;
  }

  observe() {
    /* noop — tests drive callbacks manually */
  }

  disconnect() {
    if (MockResizeObserver.last === this) MockResizeObserver.last = null;
  }

  emit(width: number) {
    this.cb(
      [
        {
          contentRect: { width, height: 0, top: 0, left: 0, bottom: 0, right: width, x: 0, y: 0, toJSON: () => ({}) },
          contentBoxSize: [{ inlineSize: width, blockSize: 0 }],
          borderBoxSize: [{ inlineSize: width, blockSize: 0 }],
          devicePixelContentBoxSize: [{ inlineSize: width, blockSize: 0 }],
          target: document.createElement('div')
        } as ResizeObserverEntry
      ],
      this as unknown as ResizeObserver
    );
  }
}

describe('useModelPickerLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MockResizeObserver.last = null;
  });

  it('starts split and collapses details below split breakpoint', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const el = document.createElement('div');
    document.body.appendChild(el);
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ width: MODEL_PICKER_SPLIT_MIN_PX - 40 })
    });

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      ref.current = el;
      return { ref, layout: useModelPickerLayout(ref) };
    });

    expect(result.current.layout.mode).toBe('stacked');
    expect(result.current.layout.detailsOpen).toBe(false);

    act(() => {
      MockResizeObserver.last?.emit(MODEL_PICKER_SPLIT_MIN_PX + 40);
    });

    expect(result.current.layout.mode).toBe('split');
    expect(result.current.layout.detailsOpen).toBe(true);

    document.body.removeChild(el);
  });

  it('toggles stacked details without leaking observers', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    const el = document.createElement('div');
    document.body.appendChild(el);
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ width: 320 })
    });

    const { result, unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      ref.current = el;
      return useModelPickerLayout(ref);
    });

    act(() => {
      result.current.toggleDetails();
    });
    expect(result.current.detailsOpen).toBe(true);

    unmount();
    document.body.removeChild(el);
    expect(MockResizeObserver.last).toBeNull();
  });
});
