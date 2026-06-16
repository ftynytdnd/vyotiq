/**
 * RightWorkbenchRail — vertical workbench activity strip in the reserved
 * right padding column.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RightWorkbenchRail } from '@renderer/components/workbench/RightWorkbenchRail';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useBrowserStore } from '@renderer/store/useBrowserStore';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

describe('RightWorkbenchRail', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeId: 'ws-1',
      info: { path: 'C:\\proj' }
    } as never);
    useTerminalStore.setState({ open: false } as never);
    useBrowserStore.setState({ open: false } as never);
    useEditorStore.setState({ open: false } as never);
  });

  it('renders vertical terminal, browser, and editor launchers', () => {
    render(<RightWorkbenchRail />);
    expect(document.querySelector('[data-workbench-right-rail]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /open terminal/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open browser/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open editor/i })).toBeTruthy();
  });
});
