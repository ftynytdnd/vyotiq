import { describe, expect, it } from 'vitest';
import {
  buildCapturePickerNavRows,
  filterCaptureSources,
  isStaleCaptureSourceError
} from '@renderer/components/composer/capture/capturePickerModel.js';

describe('capturePickerModel', () => {
  it('filters sources case-insensitively', () => {
    const sources = [
      { id: 'window:1', name: 'Vyotiq — Agent' },
      { id: 'window:2', name: 'Chrome' }
    ];
    expect(filterCaptureSources(sources, 'vyotiq')).toHaveLength(1);
  });

  it('builds nav rows with app window first', () => {
    const rows = buildCapturePickerNavRows(
      [{ id: 'screen:0', name: 'Display' }],
      [{ id: 'window:1', name: 'App' }]
    );
    expect(rows[0]).toEqual({ kind: 'app-window', id: 'app-window' });
    expect(rows).toHaveLength(3);
  });

  it('detects stale capture errors', () => {
    expect(isStaleCaptureSourceError(new Error('Capture source is no longer available.'))).toBe(
      true
    );
    expect(isStaleCaptureSourceError(new Error('permission denied'))).toBe(false);
  });
});
