import { describe, expect, it } from 'vitest';
import { reorderWorkspaceTabs } from '@renderer/lib/editorTabReorder';
import type { EditorTab } from '@renderer/store/useEditorStore';

function tab(filePath: string, workspaceId: string | null): EditorTab {
  return {
    filePath,
    workspaceId,
    content: '',
    savedContent: '',
    mtimeMs: 0,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null,
    eol: 'lf',
    encoding: 'utf-8',
    utf8Bom: false
  };
}

describe('reorderWorkspaceTabs', () => {
  it('reorders tabs within a workspace while preserving other slots', () => {
    const tabs = [
      tab('src/a.ts', 'ws-1'),
      tab('src/b.ts', 'ws-1'),
      tab('other/x.ts', 'ws-2')
    ];
    const next = reorderWorkspaceTabs(tabs, 'ws-1', 'src/b.ts', 'src/a.ts');
    expect(next.map((entry) => entry.filePath)).toEqual(['src/b.ts', 'src/a.ts', 'other/x.ts']);
  });

  it('returns the same array reference when nothing changes', () => {
    const tabs = [tab('src/a.ts', 'ws-1')];
    expect(reorderWorkspaceTabs(tabs, 'ws-1', 'src/a.ts', 'src/a.ts')).toBe(tabs);
  });
});
