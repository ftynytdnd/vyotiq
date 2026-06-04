/**
 * `mirrorOf` — projects slice fields onto the active store mirror.
 */

import { describe, expect, it } from 'vitest';
import { mirrorOf } from '@renderer/store/chatStoreMirror';
import { emptySlice } from '@renderer/store/chatStoreTypes';

describe('mirrorOf', () => {
  it('copies lastUserPromptId from the active slice', () => {
    const slice = emptySlice('conv-mirror-1');
    slice.lastUserPromptId = 'prompt-1';
    const mirror = mirrorOf(slice);
    expect(mirror.lastUserPromptId).toBe('prompt-1');
  });
});
