/**
 * CompanionDeck — workbench side pane shell.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompanionDeck } from '@renderer/components/workbench/CompanionDeck';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useUiStore } from '@renderer/store/useUiStore';

describe('CompanionDeck', () => {
  beforeEach(() => {
    useEditorStore.setState({
      open: false,
      tabs: [],
      activeFilePath: null
    } as never);
    useTerminalStore.setState({
      open: true,
      workspaceId: 'ws-1',
      sessions: [],
      activeSessionId: null,
      splitSessionId: null,
      attaching: true,
      error: null,
      searchOpen: false
    } as never);
    useUiStore.setState({ workbenchTab: 'terminal' });
  });

  it('renders workbench chrome with tab bar and active canvas', () => {
    useEditorStore.setState({
      open: true,
      tabs: [
        { filePath: 'src/a.ts', workspaceId: 'ws-1', loading: false } as never,
        { filePath: 'src/b.ts', workspaceId: 'ws-1', loading: false } as never
      ],
      activeFilePath: 'src/a.ts'
    } as never);
    useUiStore.setState({ workbenchTab: 'editor' });
    const { container } = render(<CompanionDeck />);
    expect(container.querySelector('[data-workbench-companion]')).toBeTruthy();
    expect(screen.getByRole('tablist', { name: /workbench panels/i })).toBeTruthy();
    expect(container.querySelector('.vx-editor-canvas')).toBeTruthy();
  });

  it('switches canvas when workbench tab changes', () => {
    useEditorStore.setState({
      open: true,
      tabs: [{ filePath: 'src/a.ts', workspaceId: 'ws-1', loading: false } as never],
      activeFilePath: 'src/a.ts'
    } as never);
    useUiStore.setState({ workbenchTab: 'editor' });
    const { container } = render(<CompanionDeck />);
    expect(container.querySelector('.vx-editor-canvas')).toBeTruthy();
  });
});
