/**
 * WorkbenchToolbar — contextual labels for companion panels only.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchToolbar } from '@renderer/components/workbench/WorkbenchToolbar';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useEditorStore } from '@renderer/store/useEditorStore';

describe('WorkbenchToolbar', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeId: 'ws-1',
      info: { path: 'C:\\proj' },
      list: [{ id: 'ws-1', label: 'agent', path: 'C:\\proj', addedAt: 0 }]
    } as never);
  });

  it('shows workspace-relative path in editor toolbar', () => {
    useEditorStore.setState({
      open: true,
      tabs: [
        {
          filePath: 'C:\\proj\\src\\main.py',
          workspaceId: 'ws-1',
          content: 'x',
          savedContent: 'x',
          mtimeMs: 1,
          truncated: false,
          loading: false,
          saving: false,
          staleOnDisk: false,
          error: null
        }
      ],
      activeFilePath: 'C:\\proj\\src\\main.py'
    } as never);
    render(<WorkbenchToolbar tab="editor" />);
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('main.py')).toBeTruthy();
  });
});
