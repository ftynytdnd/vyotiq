/**
 * Workbench tab-cycle focus — cycles only among open companion surfaces.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cycleWorkbenchFocus } from '@renderer/components/workbench/workbenchShared';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useBrowserStore } from '@renderer/store/useBrowserStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useAttachmentPreviewStore } from '@renderer/store/useAttachmentPreviewStore';
import { useSourceControlStore } from '@renderer/store/useSourceControlStore';
import * as workbenchFocusDom from '@renderer/lib/workbenchFocusDom.js';

describe('cycleWorkbenchFocus', () => {
  beforeEach(() => {
    useTerminalStore.setState({ open: false, workspaceId: null });
    useBrowserStore.setState({ open: false, url: '' });
    useEditorStore.setState({ open: false, tabs: [], activeFilePath: null });
    useAttachmentPreviewStore.setState({ attachment: null });
    useSourceControlStore.setState({ open: false, workspaceId: null });
    useUiStore.setState({ workbenchTab: 'agent' });
    vi.restoreAllMocks();
  });

  it('does nothing when no companion pane is open', () => {
    const focusSpy = vi.spyOn(workbenchFocusDom, 'focusActiveWorkbenchDom');
    cycleWorkbenchFocus('next');
    expect(useUiStore.getState().workbenchTab).toBe('agent');
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('cycles from terminal to browser when both are open', () => {
    useTerminalStore.setState({ open: true, workspaceId: 'ws-1' });
    useBrowserStore.setState({ open: true, url: 'https://example.com' });
    useUiStore.setState({ workbenchTab: 'terminal' });

    cycleWorkbenchFocus('next');
    expect(useUiStore.getState().workbenchTab).toBe('browser');
  });

  it('cycles backward from preview to browser', () => {
    useBrowserStore.setState({ open: true, url: 'https://example.com' });
    useAttachmentPreviewStore.setState({
      attachment: { name: 'shot.png', storedPath: 'ws/shot.png', mimeType: 'image/png' }
    });
    useUiStore.setState({ workbenchTab: 'preview' });
    const focusSpy = vi.spyOn(workbenchFocusDom, 'focusActiveWorkbenchDom');

    cycleWorkbenchFocus('prev');
    expect(useUiStore.getState().workbenchTab).toBe('browser');
    expect(focusSpy).toHaveBeenCalledWith('browser');
  });
});
