import { beforeEach, describe, expect, it } from 'vitest';
import { revealFileInDockTree } from '../../../src/renderer/lib/revealFileInDockTree.js';
import { useUiStore } from '../../../src/renderer/store/useUiStore.js';
import { useWorkspaceStore } from '../../../src/renderer/store/useWorkspaceStore.js';

describe('revealFileInDockTree', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activeId: 'ws-1' } as never);
    useUiStore.setState({
      dockExpanded: false,
      dockPanelTab: 'chats',
      filesExpandedWorkspaces: new Set<string>(),
      hydrated: true
    });
  });

  it('expands dock and switches to files tab', () => {
    revealFileInDockTree('src/main.ts');
    expect(useUiStore.getState().dockExpanded).toBe(true);
    expect(useUiStore.getState().dockPanelTab).toBe('files');
    expect(useUiStore.getState().filesExpandedWorkspaces.has('ws-1')).toBe(true);
  });
});
