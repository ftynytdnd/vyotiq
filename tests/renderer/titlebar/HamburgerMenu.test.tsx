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
  openCheckpoints: () => {},
  openContextInspector: () => {},
  quit: () => {}
};

const viewActions = {
  openContextInspector: () => {}
};

describe('HamburgerMenu', () => {
  it('uses the modern trigger class and exposes open state', async () => {
    render(<HamburgerMenu fileActions={fileActions} viewActions={viewActions} />);
    const trigger = screen.getByRole('button', { name: 'Menu' });
    expect(trigger.className).toContain('vx-titlebar-hamburger-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /New chat/i })).toBeInTheDocument();
  });

  it('styles menu rows with shared titlebar menu item class', async () => {
    render(<HamburgerMenu fileActions={fileActions} viewActions={viewActions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const row = screen.getByRole('menuitem', { name: /Settings/i });
    expect(row.className).toContain('vx-titlebar-menu-item');
  });
});
