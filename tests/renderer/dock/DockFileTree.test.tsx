/**
 * DockFileTree — filter, truncation banner, active file highlight.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({
        key: index,
        index,
        start: index * 28,
        size: 28
      })),
    getTotalSize: () => opts.count * 28,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn()
  })
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockFileTree } from '@renderer/components/dock/DockFileTree';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { invalidateWorkspaceTreeCache } from '@renderer/lib/workspaceTreeCache';
import { invalidateWorkspaceChildrenCache } from '@renderer/lib/workspaceChildrenCache';
import { useDockFileTreeSelectionStore } from '@renderer/store/useDockFileTreeSelectionStore';

const WS = 'ws-1';

beforeEach(() => {
  invalidateWorkspaceTreeCache();
  invalidateWorkspaceChildrenCache();
  useDockFileTreeSelectionStore.setState({ workspaceId: null, paths: [] });
  useWorkspaceStore.setState({
    activeId: WS,
    list: [{ id: WS, label: 'Proj', path: 'C:\\proj' }],
    info: { path: 'C:\\proj', label: 'Proj' }
  } as never);
  useSettingsStore.setState({
    settings: { ui: { fileTreeExpandedByWorkspace: { [WS]: ['src'] } } }
  } as never);
  useEditorStore.setState({
    open: true,
    tabs: [
      {
        filePath: 'src/main.ts',
        workspaceId: WS,
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
        utf8Bom: false,
        agentStreaming: false
      }
    ],
    activeFilePath: 'src/main.ts',
    pendingUnsavedClose: null,
    filePath: 'src/main.ts',
    workspaceId: WS,
    content: '',
    savedContent: '',
    mtimeMs: 0,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null
  });
  window.vyotiq.workspace.listChildren = vi.fn(async (input: { relativeDir?: string }) => {
    const dir = (input?.relativeDir ?? '').replace(/\/$/, '');
    if (dir === '') {
      return { entries: ['src/', 'docs/readme.md'] };
    }
    if (dir === 'src') {
      return { entries: ['src/main.ts'] };
    }
    return { entries: [] };
  }) as unknown as typeof window.vyotiq.workspace.listChildren;
  window.vyotiq.workspace.listTree = vi.fn(async () =>
    ({
      entries: ['src/', 'src/main.ts', 'docs/readme.md'],
      truncated: true,
      total: 1200
    }) as never
  ) as unknown as typeof window.vyotiq.workspace.listTree;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DockFileTree', () => {
  it('shows truncation banner when filter tree is capped', async () => {
    const user = userEvent.setup();
    render(<DockFileTree workspaceId={WS} />);
    await user.type(screen.getByPlaceholderText('Filter files…'), 'a');
    await waitFor(() => {
      expect(screen.getByText(/Showing .* of 1200 files/)).toBeInTheDocument();
    });
  });

  it('filters files by inline query', async () => {
    render(<DockFileTree workspaceId={WS} />);
    await waitFor(() => {
      expect(screen.getByText('readme.md')).toBeInTheDocument();
    });
    const filter = screen.getByPlaceholderText('Filter files…');
    fireEvent.change(filter, { target: { value: 'readme' } });
    await waitFor(() => {
      expect(screen.getByText('readme.md')).toBeInTheDocument();
      expect(screen.queryByText('main.ts')).toBeNull();
    });
  });

  it('loads folder children on expand', async () => {
    const user = userEvent.setup();
    render(<DockFileTree workspaceId={WS} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('treeitem', { name: /src folder/i }));
    await waitFor(() => {
      expect(screen.getByText('main.ts')).toBeInTheDocument();
    });
    expect(window.vyotiq.workspace.listChildren).toHaveBeenCalledWith(
      expect.objectContaining({ relativeDir: 'src' })
    );
  });

  it('highlights the active editor file row', async () => {
    const user = userEvent.setup();
    render(<DockFileTree workspaceId={WS} />);
    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('treeitem', { name: /src folder/i }));
    await waitFor(() => {
      const row = screen.getByRole('treeitem', { name: 'main.ts' });
      expect(row.className).toMatch(/vx-dock-file-tree-row-active/);
      expect(row.className).toMatch(/bg-accent\/10/);
    });
  });

  it('filter input uses text type with left padding for search icon', async () => {
    render(<DockFileTree workspaceId={WS} />);
    const filter = await screen.findByLabelText('Filter files');
    expect(filter).toHaveAttribute('type', 'text');
    expect(filter.className).toMatch(/pl-8/);
    expect(filter).toHaveAttribute('autocomplete', 'off');
  });
});
