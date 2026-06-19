import { describe, expect, it } from 'vitest';
import {
  captureSourceKind,
  groupCaptureSources
} from '@renderer/components/composer/capture/groupCaptureSources';

describe('groupCaptureSources', () => {
  it('splits screen and window ids', () => {
    const grouped = groupCaptureSources([
      { id: 'screen:0:0', name: 'Entire screen' },
      { id: 'window:42:0', name: 'Vyotiq' }
    ]);
    expect(grouped.screens).toHaveLength(1);
    expect(grouped.windows).toHaveLength(1);
    expect(captureSourceKind('screen:1:0')).toBe('screen');
    expect(captureSourceKind('window:1:0')).toBe('window');
  });
});
