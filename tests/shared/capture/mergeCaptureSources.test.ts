import { describe, expect, it } from 'vitest';
import { mergeCaptureSources } from '@shared/capture/mergeCaptureSources.js';

describe('mergeCaptureSources', () => {
  it('merges thumbnails by id without reordering', () => {
    const base = [
      { id: 'screen:0', name: 'Display 1' },
      { id: 'window:1', name: 'App' }
    ];
    const withThumbs = [
      { id: 'window:1', name: 'App', thumbnailDataUrl: 'data:image/jpeg;base64,abc' },
      { id: 'screen:0', name: 'Display 1', thumbnailDataUrl: 'data:image/jpeg;base64,def' }
    ];
    expect(mergeCaptureSources(base, withThumbs)).toEqual([
      { id: 'screen:0', name: 'Display 1', thumbnailDataUrl: 'data:image/jpeg;base64,def' },
      { id: 'window:1', name: 'App', thumbnailDataUrl: 'data:image/jpeg;base64,abc' }
    ]);
  });
});
