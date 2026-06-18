/**
 * DockToolbar — POL-3: plus-only when collapsed, label when expanded.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockToolbar } from '@renderer/components/dock/DockToolbar';

const baseProps = {
  searchOpen: false,
  onNewChat: vi.fn(),
  onToggleSearch: vi.fn(),
  onOpenSettings: vi.fn(),
  onCollapse: vi.fn()
};

describe('DockToolbar', () => {
  it('shows icon-only nav controls in titlebar mode', () => {
    render(
      <DockToolbar
        layout="horizontal"
        titlebarMode
        dockExpanded
        {...baseProps}
        collapseIcon="left"
      />
    );
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.queryByText('New chat')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search chats and files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows New chat label when dock is expanded (horizontal footer layout)', () => {
    render(<DockToolbar layout="horizontal" {...baseProps} collapseIcon="left" />);
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByText('New chat')).toBeInTheDocument();
  });

  it('shows plus icon only when dock is collapsed (vertical layout)', () => {
    render(<DockToolbar layout="vertical" {...baseProps} collapseIcon="right" />);
    const btn = screen.getByRole('button', { name: 'New chat' });
    expect(btn).toBeInTheDocument();
    expect(btn.textContent?.trim()).toBe('');
  });

  it('shows Settings in horizontal footer toolbar', async () => {
    const onOpenSettings = vi.fn();
    render(
      <DockToolbar
        layout="horizontal"
        {...baseProps}
        onOpenSettings={onOpenSettings}
        collapseIcon="left"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('shows Settings in vertical collapsed rail', async () => {
    const onOpenSettings = vi.fn();
    render(
      <DockToolbar
        layout="vertical"
        {...baseProps}
        onOpenSettings={onOpenSettings}
        collapseIcon="right"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('shows only back in horizontal settings mode', () => {
    render(
      <DockToolbar
        layout="horizontal"
        settingsMode
        onBackFromSettings={vi.fn()}
        {...baseProps}
        collapseIcon="right"
      />
    );
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand navigation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
  });

  it('shows only back in settings strip mode', () => {
    render(
      <DockToolbar
        layout="vertical"
        dockStyle
        settingsMode
        onBackFromSettings={vi.fn()}
        {...baseProps}
        collapseIcon="right"
      />
    );
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search chats and files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });
});
