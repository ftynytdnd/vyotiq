/**
 * Title bar — compact shell chrome (menu + window controls only).
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TitleBar } from '@renderer/components/titlebar/TitleBar';

const fileActions = {
  newConversation: () => {},
  openWorkspace: () => {},
  setWorkspacePath: () => {},
  openSettings: () => {},
  quit: () => {}
};

const titlebarProps = {
  fileActions,
  onBackFromSettings: () => {}
};

describe('TitleBar — shell chrome', () => {
  it('renders hamburger menu, dock chrome, and window controls', () => {
    render(<TitleBar {...titlebarProps} />);

    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Companion panels' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
  });
});
