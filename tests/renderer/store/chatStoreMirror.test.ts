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

  it('copies followUps from the active slice', () => {
    const slice = emptySlice('conv-mirror-2');
    slice.followUps = {
      steering: [
        {
          id: 'fu-1',
          kind: 'steering',
          prompt: 'steer',
          createdAt: 1,
          source: 'user'
        }
      ],
      queued: []
    };
    const mirror = mirrorOf(slice);
    expect(mirror.followUps.steering).toHaveLength(1);
    expect(mirror.followUps.steering[0]?.prompt).toBe('steer');
  });
});
