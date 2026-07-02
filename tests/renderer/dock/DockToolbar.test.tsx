/**

 * DockToolbar — titlebar-integrated dock actions.

 */



import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import { DockToolbar } from '@renderer/components/dock/DockToolbar';



const baseProps = {
  searchOpen: false,
  schedulesOpen: false,
  enabledScheduleCount: 0,
  onNewChat: vi.fn(),
  onToggleSearch: vi.fn(),
  onToggleSchedules: vi.fn(),
  onCollapse: vi.fn()
};



describe('DockToolbar', () => {

  it('hides new chat and search while dock is expanded', () => {

    render(

      <DockToolbar

        dockExpanded

        {...baseProps}

        collapseIcon="left"

      />

    );

    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();

    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();

    expect(screen.queryByRole('button', { name: 'Search skills, chats, messages, and files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scheduled runs' })).toBeNull();

  });



  it('shows only expand when dock is collapsed (actions live in menu / shortcuts)', () => {

    render(

      <DockToolbar

        dockExpanded={false}

        {...baseProps}

        collapseIcon="right"

      />

    );

    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();

    expect(screen.queryByRole('button', { name: 'Search skills, chats, messages, and files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scheduled runs' })).toBeNull();

  });



  it('shows schedules when enabled count is positive', () => {

    render(

      <DockToolbar

        dockExpanded={false}

        {...baseProps}

        enabledScheduleCount={2}

        collapseIcon="right"

      />

    );

    expect(screen.getByRole('button', { name: 'Scheduled runs' })).toBeInTheDocument();

  });



  it('shows only back in settings mode', () => {

    render(

      <DockToolbar

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

});
