/**
 * Title bar keyboard-shortcut popover behavior.
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

describe('TitleBar — keyboard shortcut popover', () => {
  it('renders Settings + a shortcuts trigger, but no shortcut rows by default', () => {
    render(
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.queryByText('Toggle navigation dock')).toBeNull();
    expect(screen.queryByText('Search chats')).toBeNull();
    expect(screen.queryByText('Prev / next chat')).toBeNull();
  });

  it('clicking the help trigger opens the shortcuts popover with all rows', async () => {
    render(
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={() => {}}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    expect(screen.getByText('Toggle navigation dock')).toBeTruthy();
    expect(screen.getByText('Search chats')).toBeTruthy();
    expect(screen.getByText('Prev / next chat')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('Escape closes the open popover', async () => {
    render(
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={() => {}}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    await userEvent.click(trigger);
    expect(screen.queryByText('Toggle navigation dock')).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Toggle navigation dock')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
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
