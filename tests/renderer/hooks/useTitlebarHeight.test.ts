/**
 * useTitlebarHeight — publishes measured chrome metrics on :root.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { renderHook } from '@testing-library/react';
import { useTitlebarHeight } from '@renderer/hooks/useTitlebarHeight';

describe('useTitlebarHeight', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--titlebar-h');
    document.documentElement.style.removeProperty('--titlebar-h-measured');
    document.documentElement.style.removeProperty('--dock-strip-pt');
  });

  it('sets --titlebar-h and --dock-strip-pt from the observed element height', () => {
    const ref = createRef<HTMLElement>();
    const el = document.createElement('header');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ height: 34, width: 800, top: 0, left: 0, right: 800, bottom: 34 })
    });
    ref.current = el;

    renderHook(() => useTitlebarHeight(ref));

    expect(document.documentElement.style.getPropertyValue('--titlebar-h')).toBe('34px');
    expect(document.documentElement.style.getPropertyValue('--titlebar-h-measured')).toBe('34px');
    expect(document.documentElement.style.getPropertyValue('--dock-strip-pt')).toBe('34px');
  });

  it('ignores sub-threshold height reads', () => {
    const ref = createRef<HTMLElement>();
    const el = document.createElement('header');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ height: 0, width: 800, top: 0, left: 0, right: 800, bottom: 0 })
    });
    ref.current = el;

    renderHook(() => useTitlebarHeight(ref));

    expect(document.documentElement.style.getPropertyValue('--titlebar-h')).toBe('');
  });

  it('offsets dock strip by full title bar height', () => {
    const ref = createRef<HTMLElement>();
    const el = document.createElement('header');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ height: 38, width: 800, top: 0, left: 0, right: 800, bottom: 38 })
    });
    ref.current = el;

    renderHook(() => useTitlebarHeight(ref));

    expect(document.documentElement.style.getPropertyValue('--titlebar-h')).toBe('38px');
    expect(document.documentElement.style.getPropertyValue('--dock-strip-pt')).toBe('38px');
  });
});
