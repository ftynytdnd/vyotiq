/**
 * `SidebarFooter` keyboard-shortcut popover behavior.
 *
 * Regression: the always-visible 10 px shortcut block at the sidebar
 * bottom was illegible at production resolution. The shortcut row was
 * removed and the same surface now opens via a `?` trigger button. This
 * test pins the new disclosure behavior:
 *
 *   - The trigger renders next to Settings and is keyboard-accessible.
 *   - Clicking it opens a popover containing the shortcut rows.
 *   - Escape and outside-click close the popover.
 *   - The shortcut rows are NOT rendered until the trigger is opened.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarFooter } from '@renderer/components/sidebar/SidebarFooter';

describe('SidebarFooter — keyboard shortcut popover', () => {
  it('renders Settings + a shortcuts trigger, but no shortcut rows by default', () => {
    render(<SidebarFooter onOpenSettings={() => { }} onOpenCheckpoints={() => { }} />);

    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.queryByText('Toggle sidebar')).toBeNull();
    expect(screen.queryByText('Search chats')).toBeNull();
    expect(screen.queryByText('Prev / next chat')).toBeNull();
  });

  it('clicking the `?` trigger opens the shortcuts popover with all rows', async () => {
    render(<SidebarFooter onOpenSettings={() => { }} onOpenCheckpoints={() => { }} />);

    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(trigger);

    // aria-expanded reflects the open state.
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // All three shortcut rows render inside the popover.
    expect(screen.getByText('Toggle sidebar')).toBeTruthy();
    expect(screen.getByText('Search chats')).toBeTruthy();
    expect(screen.getByText('Prev / next chat')).toBeTruthy();

    // The dialog role is set on the popover content itself for screen
    // readers (the Popover primitive renders the trigger; the inner
    // `ShortcutsPanel` carries `role="dialog"`).
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('Escape closes the open popover', async () => {
    render(<SidebarFooter onOpenSettings={() => { }} onOpenCheckpoints={() => { }} />);

    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    await userEvent.click(trigger);
    expect(screen.queryByText('Toggle sidebar')).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Toggle sidebar')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking outside closes the open popover', async () => {
    render(
      <div>
        <button type="button" data-testid="outside">outside</button>
        <SidebarFooter onOpenSettings={() => { }} onOpenCheckpoints={() => { }} />
      </div>
    );

    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    await userEvent.click(trigger);
    expect(screen.queryByText('Toggle sidebar')).not.toBeNull();

    await userEvent.click(screen.getByTestId('outside'));
    expect(screen.queryByText('Toggle sidebar')).toBeNull();
  });

  it('Settings click forwards through to onOpenSettings', async () => {
    const onOpenSettings = vi.fn();
    render(<SidebarFooter onOpenSettings={onOpenSettings} onOpenCheckpoints={() => { }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
