/**
 * BrowserCanvas — flat edge-to-edge layout aligned with terminal/editor.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { BrowserCanvas } from '@renderer/components/workbench/BrowserCanvas';
import { useBrowserStore } from '@renderer/store/useBrowserStore';

describe('BrowserCanvas', () => {
  beforeEach(() => {
    useBrowserStore.setState({
      open: true,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      hasLoaded: false,
      findOpen: false
    } as never);
  });

  it('renders a flat canvas with empty state and no sunken slot background class', () => {
    const { container } = render(<BrowserCanvas />);
    expect(container.querySelector('.vx-browser-canvas')).toBeTruthy();
    expect(container.querySelector('.vx-browser-empty')).toBeTruthy();
    expect(screen.getByText(/address bar above/)).toBeTruthy();
    const slot = container.querySelector('.vx-browser-slot');
    expect(slot).toBeTruthy();
  });

  it('shows error state with muted copy', () => {
    useBrowserStore.setState({ error: 'Failed to attach browser' } as never);
    render(<BrowserCanvas />);
    expect(screen.getByText('Failed to attach browser')).toBeTruthy();
    expect(screen.queryByText(/address bar above/)).toBeNull();
  });

  it('renders find overlay when findOpen is true', () => {
    useBrowserStore.setState({ findOpen: true, hasLoaded: true } as never);
    const { container } = render(<BrowserCanvas />);
    expect(container.querySelector('.vx-workbench-find')).toBeTruthy();
  });
});
