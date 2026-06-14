/**
 * WorkbenchTabBar — unified scroll row with terminal, globe, and file tabs.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchTabBar } from '@renderer/components/workbench/WorkbenchTabBar';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useUiStore } from '@renderer/store/useUiStore';

describe('WorkbenchTabBar', () => {
  beforeEach(() => {
    useUiStore.setState({ workbenchTab: 'terminal' });
    useTerminalStore.setState({
      open: true,
      workspaceId: 'ws-1',
      shellLabel: 'powershell',
      attaching: false
    });
    useEditorStore.setState({
      open: true,
      tabs: [
        {
          filePath: 'C:\\proj\\src\\main.py',
          workspaceId: 'ws-1',
          content: '',
          savedContent: '',
          mtimeMs: null,
          truncated: false,
          loading: false,
          saving: false,
          staleOnDisk: false,
          error: null
        }
      ],
      activeFilePath: 'C:\\proj\\src\\main.py'
    } as never);
  });

  it('renders shell label, globe, and file tabs in one scroll row', () => {
    const { container } = render(<WorkbenchTabBar />);
    const scroll = container.querySelector('[data-workbench-tab-scroll]');
    expect(scroll).toBeTruthy();

    const tabLabels = Array.from(scroll!.querySelectorAll('[role="tab"]')).map((el) =>
      el.textContent?.trim()
    );
    expect(tabLabels).toEqual(expect.arrayContaining(['powershell', 'Globe', 'main.py']));
    expect(screen.queryByRole('tab', { name: /^agent$/i })).toBeNull();
    expect(screen.getByRole('tab', { name: /main\.py/i })).toBeTruthy();
  });

  it('falls back to Terminal when shell label is missing', () => {
    useTerminalStore.setState({ shellLabel: null });
    render(<WorkbenchTabBar />);
    expect(screen.getByRole('tab', { name: /^terminal$/i })).toBeTruthy();
  });
});
