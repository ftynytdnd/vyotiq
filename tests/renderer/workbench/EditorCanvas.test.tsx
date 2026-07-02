/**
 * EditorCanvas — LSP status deep-links to Editor LSP settings.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditorCanvas } from '@renderer/components/workbench/EditorCanvas';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

vi.mock('@renderer/hooks/useEditorLsp.js', () => ({
  useEditorLsp: () => ({
    status: { connected: false, lastError: 'not running' },
    bridge: null,
    goToDefinition: vi.fn()
  })
}));

vi.mock('@renderer/hooks/useEditorDiskWatcher.js', () => ({
  useEditorDiskWatcher: () => undefined
}));

vi.mock('@renderer/components/workbench/EditorTabViews.js', () => ({
  EditorTabViews: () => <div data-testid="editor-tab-views" />
}));

beforeEach(() => {
  useAppViewStore.setState({
    view: 'chat',
    settingsSection: 'models-api',
    pendingAgentBehaviorSection: null
  });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    info: { path: 'C:\\proj' }
  } as never);
  useSettingsStore.setState({
    settings: { ui: { editorLsp: { enabled: true } } }
  } as never);
  useEditorStore.setState({
    open: true,
    tabs: [
      {
        filePath: 'src/a.ts',
        workspaceId: 'ws-1',
        loading: false,
        truncated: false,
        staleOnDisk: false,
        eol: 'lf',
        encoding: 'utf-8',
        utf8Bom: false,
        content: 'x',
        savedContent: 'x'
      }
    ],
    activeFilePath: 'src/a.ts'
  } as never);
});

describe('EditorCanvas', () => {
  it('opens Agent behavior settings on the Editor LSP sub-section when LSP status is clicked', () => {
    render(<EditorCanvas />);
    fireEvent.click(screen.getByRole('button', { name: /LSP/i }));
    expect(useAppViewStore.getState().view).toBe('settings');
    expect(useAppViewStore.getState().settingsSection).toBe('agent-behavior');
    expect(useAppViewStore.getState().pendingAgentBehaviorSection).toBe('lsp');
  });
});
