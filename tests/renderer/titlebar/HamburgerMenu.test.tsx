/**
 * Title bar hamburger — trigger affordance and flat menu panel.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HamburgerMenu } from '@renderer/components/titlebar/HamburgerMenu';

const fileActions = {
  newConversation: () => {},
  openWorkspace: () => {},
  setWorkspacePath: () => {},
  openSettings: () => {},
  quit: () => {}
};

describe('HamburgerMenu', () => {
  it('uses the modern trigger class and exposes open state', async () => {
    render(<HamburgerMenu fileActions={fileActions} />);
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger.className).toContain('vx-titlebar-hamburger-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /New chat/i })).toBeInTheDocument();
  });

  it('styles menu rows with shared titlebar menu item class', async () => {
    render(<HamburgerMenu fileActions={fileActions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const row = screen.getByRole('menuitem', { name: /Settings/i });
    expect(row.className).toContain('vx-titlebar-menu-item');
  });

  it('shows a compact menu without edit or duplicate settings entries', async () => {
    render(<HamburgerMenu fileActions={fileActions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));

    expect(screen.getByRole('menuitem', { name: /New chat/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Settings/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Quit/i })).toBeInTheDocument();

    expect(screen.queryByRole('menuitem', { name: /Undo/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Providers & models/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Keyboard shortcuts/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Toggle DevTools/i })).toBeNull();
  });

  it('hides chat and workspace rows when chatActionsEnabled is false', async () => {
    render(
      <HamburgerMenu
        fileActions={{ ...fileActions, chatActionsEnabled: false }}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('menuitem', { name: /New chat/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Open workspace/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Settings/i })).toBeInTheDocument();
  });
});
