import { beforeEach, describe, expect, it } from 'vitest';
import { revealFileInDockTree } from '../../../src/renderer/lib/revealFileInDockTree.js';
import { useUiStore } from '../../../src/renderer/store/useUiStore.js';
import { useWorkspaceStore } from '../../../src/renderer/store/useWorkspaceStore.js';

describe('revealFileInDockTree', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activeId: 'ws-1' } as never);
    useUiStore.setState({
      dockExpanded: false,
      filesExpandedWorkspaces: new Set<string>(),
      hydrated: true
    });
  });

  it('expands dock and files panel for active workspace', () => {
    revealFileInDockTree('src/main.ts');
    expect(useUiStore.getState().dockExpanded).toBe(true);
    expect(useUiStore.getState().filesExpandedWorkspaces.has('ws-1')).toBe(true);
  });
});
