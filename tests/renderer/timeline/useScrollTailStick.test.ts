/**
 * Tail-stick scroll hook — shared threshold constant.
 */

import { describe, expect, it } from 'vitest';
import { SCROLL_TAIL_STICK_PX } from '@renderer/components/timeline/shared/useScrollTailStick';

describe('useScrollTailStick', () => {
  it('exports a stable near-bottom stick threshold', () => {
    expect(SCROLL_TAIL_STICK_PX).toBe(16);
  });
});
