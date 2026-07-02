import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../../src/renderer/store/useEditorStore.js';
import { useUiStore } from '../../../src/renderer/store/useUiStore.js';

vi.mock('../../../src/renderer/lib/ipc.js', () => ({
  vyotiq: {
    editor: { read: vi.fn(), write: vi.fn() },
    settings: { set: vi.fn() }
  }
}));

describe('useEditorStore unsaved close', () => {
  beforeEach(() => {
    useEditorStore.setState({
      open: true,
      tabs: [
        {
          filePath: 'src/a.ts',
          workspaceId: 'ws-1',
          content: 'dirty',
          savedContent: 'saved',
          mtimeMs: 1,
          truncated: false,
          loading: false,
          saving: false,
          staleOnDisk: false,
          error: null,
          eol: 'lf',
          encoding: 'utf-8',
          utf8Bom: false
        }
      ],
      activeFilePath: 'src/a.ts',
      pendingUnsavedClose: null,
      filePath: 'src/a.ts',
      workspaceId: 'ws-1',
      content: 'dirty',
      savedContent: 'saved',
      mtimeMs: 1,
      truncated: false,
      loading: false,
      saving: false,
      staleOnDisk: false,
      error: null
    });
    useUiStore.setState({ dockExpanded: false });
  });

  it('queues prompt when closing a dirty tab', () => {
    const closed = useEditorStore.getState().requestCloseTab('src/a.ts');
    expect(closed).toBe(false);
    expect(useEditorStore.getState().pendingUnsavedClose).toBe('src/a.ts');
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it('closes clean tabs immediately', () => {
    useEditorStore.setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => ({ ...t, content: 'saved', savedContent: 'saved' }))
    }));
    const closed = useEditorStore.getState().requestCloseTab('src/a.ts');
    expect(closed).toBe(true);
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });
});
