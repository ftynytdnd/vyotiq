/**
 * WorkbenchTabBar — on-demand unified scroll row with terminal + file tabs.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchTabBar } from '@renderer/components/workbench/WorkbenchTabBar';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useBrowserStore } from '@renderer/store/useBrowserStore';
import { useUiStore } from '@renderer/store/useUiStore';

const SESSION = {
  sessionId: 's1',
  workspaceId: 'ws-1',
  shell: 'powershell',
  cols: 80,
  rows: 24,
  primary: true
};

describe('WorkbenchTabBar', () => {
  beforeEach(() => {
    useUiStore.setState({ workbenchTab: 'terminal' });
    useBrowserStore.setState({ open: false } as never);
    useTerminalStore.setState({
      open: true,
      workspaceId: 'ws-1',
      sessions: [SESSION],
      activeSessionId: 's1',
      splitSessionId: null,
      attaching: false
    } as never);
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
          error: null,
          eol: 'lf',
          encoding: 'utf-8'
        }
      ],
      activeFilePath: 'C:\\proj\\src\\main.py'
    } as never);
  });

  it('renders open terminal + file tabs in one scroll row', () => {
    const { container } = render(<WorkbenchTabBar />);
    const scroll = container.querySelector('[data-workbench-tab-scroll]');
    expect(scroll).toBeTruthy();

    const tabLabels = Array.from(scroll!.querySelectorAll('[role="tab"]')).map((el) =>
      el.textContent?.trim()
    );
    expect(tabLabels).toEqual(expect.arrayContaining(['powershell', 'main.py']));
    expect(screen.queryByRole('tab', { name: /^agent$/i })).toBeNull();
    expect(screen.getByRole('tab', { name: /main\.py/i })).toBeTruthy();
  });

  it('falls back to Terminal when no session shell label is available', () => {
    useTerminalStore.setState({ sessions: [], activeSessionId: null } as never);
    render(<WorkbenchTabBar />);
    expect(screen.getByRole('tab', { name: /^terminal$/i })).toBeTruthy();
  });
});
