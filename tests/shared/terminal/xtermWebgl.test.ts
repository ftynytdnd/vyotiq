import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldUseXtermWebglRenderer } from '@shared/terminal/xtermWebgl';

describe('shouldUseXtermWebglRenderer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false inside Electron', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Electron/34.0.0 Chrome/132.0.0.0'
    });
    expect(shouldUseXtermWebglRenderer()).toBe(false);
  });

  it('returns true in a normal browser', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Chrome/132.0.0.0 Safari/537.36'
    });
    expect(shouldUseXtermWebglRenderer()).toBe(true);
  });
});
