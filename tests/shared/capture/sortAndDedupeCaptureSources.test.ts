import { describe, expect, it } from 'vitest';
import { dedupeVyotiqWindowSources } from '@shared/capture/formatCaptureSourceName.js';
import { sortCaptureSources } from '@shared/capture/sortCaptureSources.js';

describe('dedupeVyotiqWindowSources', () => {
  it('keeps only the current app window when ids are known', () => {
    const sources = [
      { id: 'window:1:0', name: 'Vyotiq — Agent' },
      { id: 'window:2:0', name: 'Vyotiq — Other' },
      { id: 'window:3:0', name: 'Chrome' }
    ];
    expect(dedupeVyotiqWindowSources(sources, 'window:1:0')).toEqual([
      { id: 'window:1:0', name: 'Vyotiq — Agent' },
      { id: 'window:3:0', name: 'Chrome' }
    ]);
  });
});

describe('sortCaptureSources', () => {
  it('places the foreground window first', () => {
    const sorted = sortCaptureSources(
      [
        { id: 'window:2:0', name: 'Chrome' },
        { id: 'window:1:0', name: 'Vyotiq' },
        { id: 'screen:0:0', name: 'Display' }
      ],
      'window:2:0'
    );
    expect(sorted.map((s) => s.id)).toEqual(['screen:0:0', 'window:2:0', 'window:1:0']);
  });
});
