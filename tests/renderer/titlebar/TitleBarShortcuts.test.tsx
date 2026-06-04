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
  openCheckpoints: () => {},
  quit: () => {}
};

describe('TitleBar — shell chrome', () => {
  it('renders hamburger menu and window controls without duplicate settings affordances', () => {
    render(<TitleBar fileActions={fileActions} />);

    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
  });
});
