/**
 * `mirrorOf` — projects slice fields onto the active store mirror.
 */

import { describe, expect, it } from 'vitest';
import { mirrorOf } from '@renderer/store/chatStoreMirror';
import { emptySlice } from '@renderer/store/chatStoreTypes';

describe('mirrorOf', () => {
  it('copies lastDelegationPhaseTs from the active slice', () => {
    const slice = emptySlice('conv-mirror-1');
    slice.lastDelegationPhaseTs = 42_000;
    const mirror = mirrorOf(slice);
    expect(mirror.lastDelegationPhaseTs).toBe(42_000);
  });
});
