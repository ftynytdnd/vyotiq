/**
 * TitlebarChrome — horizontal dock nav and workbench launchers in titlebar.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitlebarDockChrome, TitlebarWorkbenchChrome } from '@renderer/components/titlebar/TitlebarChrome';
import { useUiStore } from '@renderer/store/useUiStore';
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useBrowserStore } from '@renderer/store/useBrowserStore';
import { useEditorStore } from '@renderer/store/useEditorStore';

beforeEach(() => {
  useUiStore.setState({ dockExpanded: false, dockWidth: 260, hydrated: true });
  useAppViewStore.setState({ view: 'chat', settingsSection: 'general', aboutOpen: false });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    info: { path: 'C:\\proj' }
  } as never);
  useTerminalStore.setState({ open: false } as never);
  useBrowserStore.setState({ open: false } as never);
  useEditorStore.setState({ open: false } as never);
});

describe('TitlebarDockChrome', () => {
  it('renders collapse control when chat view is active', () => {
    render(<TitlebarDockChrome onBackFromSettings={() => {}} />);
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search skills, chats, messages, and files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scheduled runs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument();
  });

  it('shows back only in settings mode', () => {
    useAppViewStore.setState({ view: 'settings' });
    render(<TitlebarDockChrome onBackFromSettings={() => {}} />);
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('expands dock from collapse control', () => {
    render(<TitlebarDockChrome onBackFromSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(useUiStore.getState().dockExpanded).toBe(true);
  });
});

describe('TitlebarWorkbenchChrome', () => {
  it('renders compact companion panels menu', async () => {
    const user = userEvent.setup();
    render(<TitlebarWorkbenchChrome />);
    await user.click(screen.getByRole('button', { name: 'Companion panels' }));
    expect(screen.getByRole('menuitem', { name: /Terminal/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Browser/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Editor/i })).toBeTruthy();
  });

  it('hides launchers in settings mode', () => {
    useAppViewStore.setState({ view: 'settings' });
    render(<TitlebarWorkbenchChrome />);
    expect(screen.queryByRole('button', { name: 'Companion panels' })).toBeNull();
  });

  it('shows active dot when a companion panel is open', () => {
    useEditorStore.setState({ open: true } as never);
    useUiStore.setState({ workbenchTab: 'editor' });
    render(<TitlebarWorkbenchChrome />);
    expect(screen.getByRole('button', { name: 'Companion panels' })).toBeTruthy();
  });
});
