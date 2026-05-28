/**
 * DockToolbar — POL-3: plus-only when collapsed, label when expanded.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DockToolbar } from '@renderer/components/dock/DockToolbar';

const baseProps = {
  searchOpen: false,
  onNewChat: vi.fn(),
  onToggleSearch: vi.fn(),
  onCollapse: vi.fn()
};

describe('DockToolbar', () => {
  it('shows New chat label when dock is expanded (horizontal layout)', () => {
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
});
