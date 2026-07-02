/**
 * App shell layout — titlebar + dock + workbench composition smoke test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeftDock } from '@renderer/components/dock/LeftDock';
import { TitleBar } from '@renderer/components/titlebar/TitleBar';
import { WorkbenchShell } from '@renderer/components/workbench/WorkbenchShell';
import { SettingsFullView } from '@renderer/components/settings/SettingsFullView';
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';

vi.mock('@renderer/hooks/useTitlebarHeight.js', () => ({
  useTitlebarHeight: () => undefined
}));

const dockProps = {
  onSetWorkspacePath: () => {}
};

const fileActions = {
  openSettings: () => useAppViewStore.getState().openSettings(),
  newChat: () => {},
  closeWindow: () => {}
};

function AppShellFixture({ settingsOpen }: { settingsOpen: boolean }) {
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const mainPaddingLeft = dockExpanded && !settingsOpen ? 'var(--dock-w)' : '0px';

  return (
    <div className="relative flex h-full flex-col bg-surface-base">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <LeftDock {...dockProps} settingsMode={settingsOpen} />
        <TitleBar
          fileActions={fileActions}
          onBackFromSettings={() => useAppViewStore.getState().closeSettings()}
        />
        <main
          className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
          style={{ paddingTop: 'var(--titlebar-h)', paddingLeft: mainPaddingLeft }}
        >
          {settingsOpen ? (
            <SettingsFullView />
          ) : (
            <WorkbenchShell>
              <p>Agent canvas</p>
            </WorkbenchShell>
          )}
        </main>
      </div>
    </div>
  );
}

beforeEach(() => {
  useAppViewStore.setState({
    view: 'chat',
    settingsSection: 'appearance',
    aboutOpen: false,
    pendingAgentBehaviorSection: null
  });
  useUiStore.setState({
    dockExpanded: true,
    dockWidth: 280,
    filesExpandedWorkspaces: new Set<string>(),
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Proj', path: '/tmp/proj', addedAt: 0 }],
    loading: false
  } as never);
  useConversationsStore.setState({
    list: [{ id: 'c1', title: 'Chat', updatedAt: 0, workspaceId: 'ws-1' }],
    activeIdByWorkspace: { 'ws-1': 'c1' },
    loading: false
  } as never);
  useSettingsStore.setState({
    loading: false,
    settings: { ui: { theme: 'dark' } }
  } as never);
});

describe('App shell layout', () => {
  it('renders workbench mode with dock flyout and agent-primary canvas', () => {
    render(<AppShellFixture settingsOpen={false} />);
    expect(screen.getByRole('navigation', { name: 'Workspace and session navigation' })).toBeTruthy();
    expect(screen.getByText('Agent canvas')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
  });

  it('replaces workbench with settings overlay when settings are open', () => {
    useAppViewStore.setState({ view: 'settings', settingsSection: 'appearance' });
    render(<AppShellFixture settingsOpen />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByText('Agent canvas')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Workspace and session navigation' })).toBeNull();
  });
});
