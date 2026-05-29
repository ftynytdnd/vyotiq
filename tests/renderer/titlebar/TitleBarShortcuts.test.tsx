/**
 * Title bar — hamburger menu, shortcuts help, and settings.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitleBar } from '@renderer/components/titlebar/TitleBar';

const fileActions = {
  newConversation: () => {},
  openWorkspace: () => {},
  setWorkspacePath: () => {},
  openSettings: () => {},
  openCheckpoints: () => {},
  openContextInspector: () => {},
  quit: () => {}
};

const viewActions = {
  openContextInspector: () => {}
};

describe('TitleBar — shell chrome', () => {
  it('renders hamburger menu, shortcuts help, and settings', () => {
    render(
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('opens the shortcuts reference popover from the title bar', () => {
    render(
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('Settings click forwards through to onOpenSettings', async () => {
    const onOpenSettings = vi.fn();
    render(
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={onOpenSettings}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
