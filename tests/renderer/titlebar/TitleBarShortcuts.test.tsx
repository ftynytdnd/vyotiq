/**
 * Title bar — hamburger menu + settings (shortcuts moved to Settings nav).
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  it('renders hamburger menu and settings; no title-bar shortcuts popover', () => {
    render(
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).toBeNull();
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
