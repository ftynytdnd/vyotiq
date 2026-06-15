import { beforeEach, describe, expect, it } from 'vitest';
import { revealFileInDockTree } from '../../../src/renderer/lib/revealFileInDockTree.js';
import { useUiStore } from '../../../src/renderer/store/useUiStore.js';

describe('revealFileInDockTree', () => {
  beforeEach(() => {
    useUiStore.setState({ dockExpanded: false, dockPanelTab: 'chats' });
  });

  it('expands dock and switches to files tab', () => {
    revealFileInDockTree('src/main.ts');
    expect(useUiStore.getState().dockExpanded).toBe(true);
    expect(useUiStore.getState().dockPanelTab).toBe('files');
  });
});
