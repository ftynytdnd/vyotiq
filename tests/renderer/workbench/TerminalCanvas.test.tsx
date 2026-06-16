/**
 * TerminalCanvas — flat edge-to-edge layout aligned with editor canvas.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TerminalCanvas } from '@renderer/components/workbench/TerminalCanvas';
import { useTerminalStore } from '@renderer/store/useTerminalStore';

describe('TerminalCanvas', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      open: true,
      workspaceId: 'ws-1',
      sessions: [],
      activeSessionId: null,
      splitSessionId: null,
      attaching: true,
      error: null,
      searchOpen: false
    } as never);
  });

  it('renders a flat canvas without the legacy sunken surface frame', () => {
    const { container } = render(<TerminalCanvas />);
    expect(container.querySelector('.vx-terminal-canvas')).toBeTruthy();
    expect(container.querySelector('.vx-terminal-surface')).toBeNull();
    expect(screen.getByText(/Starting shell/)).toBeTruthy();
  });

  it('shows error state with muted copy', () => {
    useTerminalStore.setState({
      attaching: false,
      error: 'Failed to start shell'
    } as never);
    render(<TerminalCanvas />);
    expect(screen.getByText('Failed to start shell')).toBeTruthy();
  });
});
