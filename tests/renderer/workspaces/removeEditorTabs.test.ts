/**
 * Removing a workspace must close its editor tabs so the workbench
 * does not keep showing files from a deleted workspace.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import type { AppSettings } from '@shared/types/ipc';

function seedEditorTab(filePath: string, workspaceId: string) {
  return {
    filePath,
    workspaceId,
    content: 'x',
    savedContent: 'x',
    mtimeMs: 1,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null,
    eol: 'lf' as const,
    encoding: 'utf-8' as const,
    utf8Bom: false
  };
}

beforeEach(async () => {
  useWorkspaceStore.setState({
    list: [
      { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
      { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
    ],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'A' },
    loading: false
  });
  useEditorStore.setState({
    open: true,
    tabs: [
      seedEditorTab('/tmp/A/foo.ts', 'ws-A'),
      seedEditorTab('/tmp/B/bar.ts', 'ws-B')
    ],
    activeFilePath: '/tmp/A/foo.ts',
    filePath: '/tmp/A/foo.ts',
    workspaceId: 'ws-A',
    content: 'x',
    savedContent: 'x',
    mtimeMs: 1,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null,
    pendingUnsavedClose: null
  });
  useSettingsStore.setState({ settings: {}, loading: false });
  window.vyotiq.settings.set = vi.fn(async (patch) => ({
    ...useSettingsStore.getState().settings,
    ...patch,
    ui: { ...(useSettingsStore.getState().settings.ui ?? {}), ...(patch.ui ?? {}) }
  })) as never;
  window.vyotiq.conversations.list = vi.fn(async () => []) as never;
  const { useConversationsStore } = await import('@renderer/store/useConversationsStore');
  useConversationsStore.setState({
    list: [],
    activeIdByWorkspace: {},
    hydratedIds: new Set<string>(),
    loading: false
  });
});

describe('workspace.remove — editor tabs', () => {
  it('closes tabs for the removed workspace and keeps sibling workspace tabs', async () => {
    window.vyotiq.workspace.remove = vi.fn(async () => ({
      activeId: 'ws-B',
      workspaces: [{ id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }]
    })) as never;

    await useWorkspaceStore.getState().remove('ws-A', { deleteConversations: false });

    const editor = useEditorStore.getState();
    expect(editor.tabs).toHaveLength(1);
    expect(editor.tabs[0]?.workspaceId).toBe('ws-B');
    expect(editor.open).toBe(true);
  });

  it('closes the editor when the last workspace is removed', async () => {
    window.vyotiq.workspace.remove = vi.fn(async () => ({
      activeId: null,
      workspaces: []
    })) as never;

    await useWorkspaceStore.getState().remove('ws-A', { deleteConversations: true });

    const editor = useEditorStore.getState();
    expect(editor.tabs).toHaveLength(0);
    expect(editor.open).toBe(false);
    expect(editor.activeFilePath).toBeNull();
  });
});
