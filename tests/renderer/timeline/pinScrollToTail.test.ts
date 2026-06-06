import { describe, expect, it } from 'vitest';
import { pinScrollParentToTail } from '@renderer/components/timeline/shared/pinScrollToTail.js';

describe('pinScrollParentToTail', () => {
  it('sets scrollTop to max scroll offset', () => {
    const parent = document.createElement('div');
    Object.defineProperty(parent, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(parent, 'clientHeight', { value: 400, configurable: true });
    let scrollTop = 0;
    Object.defineProperty(parent, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
      configurable: true
    });

    pinScrollParentToTail(parent);
    expect(scrollTop).toBe(1600);
  });
});
