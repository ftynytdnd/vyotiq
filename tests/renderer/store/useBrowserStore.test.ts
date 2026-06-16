/**
 * useBrowserStore — openPanel rolls back when attach fails.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowserStore } from '@renderer/store/useBrowserStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { vyotiq } from '@renderer/lib/ipc.js';

vi.mock('@renderer/lib/ipc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/lib/ipc.js')>();
  return {
    ...actual,
    vyotiq: {
      ...actual.vyotiq,
      browser: {
        ...actual.vyotiq.browser,
        attach: vi.fn()
      }
    }
  };
});

describe('useBrowserStore openPanel', () => {
  beforeEach(() => {
    useUiStore.setState({ workbenchTab: 'agent' });
    useBrowserStore.setState({
      open: false,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      hasLoaded: false,
      findOpen: false
    });
    vi.mocked(vyotiq.browser.attach).mockReset();
  });

  it('closes panel and stores error when attach throws', async () => {
    vi.mocked(vyotiq.browser.attach).mockRejectedValueOnce(new Error('attach failed'));

    await useBrowserStore.getState().openPanel();

    expect(useBrowserStore.getState().open).toBe(false);
    expect(useBrowserStore.getState().error).toBe('attach failed');
  });
});
