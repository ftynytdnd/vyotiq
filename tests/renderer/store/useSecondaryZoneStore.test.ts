/**
 * Secondary zone overlay slot — single open panel, closeAllOverlays.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSecondaryZoneStore } from '@renderer/store/useSecondaryZoneStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useAttachmentPreviewStore } from '@renderer/store/useAttachmentPreviewStore';
import { useFloatingLiveDiffStore } from '@renderer/store/useFloatingLiveDiffStore';

beforeEach(() => {
  useSecondaryZoneStore.setState({
    panel: null,
    settingsTab: 'providers',
    checkpointsTab: 'runs',
    agentTraceId: null
  });
  useSettingsStore.setState({
    settings: { ui: { lastSettingsTab: 'memory' } }
  });
  useAttachmentPreviewStore.setState({ attachment: null });
  useFloatingLiveDiffStore.setState({ target: null, userDismissedCallId: null });
});

describe('useSecondaryZoneStore', () => {
  it('closes other overlays when opening settings (single slot)', () => {
    useAttachmentPreviewStore.getState().open({
      name: 'x.png',
      storedPath: 'a/x.png',
      mimeType: 'image/png'
    });
    useSecondaryZoneStore.getState().openSettings('appearance');
    expect(useSecondaryZoneStore.getState().panel).toBe('settings');
    expect(useSecondaryZoneStore.getState().settingsTab).toBe('appearance');
    expect(useAttachmentPreviewStore.getState().attachment).toBeNull();
  });

  it('closes agent trace when opening attachment preview', () => {
    useSecondaryZoneStore.setState({ agentTraceId: 'sub-trace' });
    useAttachmentPreviewStore.getState().open({
      name: 'doc.pdf',
      storedPath: 'a/doc.pdf',
      mimeType: 'application/pdf'
    });
    expect(useSecondaryZoneStore.getState().agentTraceId).toBeNull();
    expect(useAttachmentPreviewStore.getState().attachment?.name).toBe('doc.pdf');
  });

  it('closes agent trace when opening live diff', () => {
    useSecondaryZoneStore.setState({ agentTraceId: 'sub-trace' });
    useFloatingLiveDiffStore.getState().open({
      callId: 'tc-2',
      filePath: 'b.ts',
      diffStream: {
        tool: 'edit',
        filePath: 'b.ts',
        additions: 0,
        deletions: 1,
        hunks: [],
        settled: false,
        ts: 2
      }
    });
    expect(useSecondaryZoneStore.getState().agentTraceId).toBeNull();
    expect(useFloatingLiveDiffStore.getState().target?.callId).toBe('tc-2');
  });

  it('closes attachment preview when opening agent trace', () => {
    useAttachmentPreviewStore.getState().open({
      name: 'x.png',
      storedPath: 'a/x.png',
      mimeType: 'image/png'
    });
    useSecondaryZoneStore.getState().openAgentTrace('sub-9');
    expect(useAttachmentPreviewStore.getState().attachment).toBeNull();
    expect(useSecondaryZoneStore.getState().agentTraceId).toBe('sub-9');
    expect(useSecondaryZoneStore.getState().panel).toBeNull();
  });

  it('closeAllOverlays clears panel, trace, and companion overlays', () => {
    useSecondaryZoneStore.setState({ panel: 'checkpoints', agentTraceId: 'sub-1' });
    useFloatingLiveDiffStore.setState({
      target: {
        callId: 'tc-1',
        filePath: 'a.ts',
        diffStream: {
          tool: 'edit',
          filePath: 'a.ts',
          additions: 1,
          deletions: 0,
          hunks: [],
          settled: false,
          ts: 1
        }
      }
    });
    useSecondaryZoneStore.getState().closeAllOverlays();
    expect(useSecondaryZoneStore.getState().panel).toBeNull();
    expect(useSecondaryZoneStore.getState().agentTraceId).toBeNull();
    expect(useFloatingLiveDiffStore.getState().target).toBeNull();
  });

  it('setSettingsTab persists lastSettingsTab via settings IPC', async () => {
    const setSpy = vi.spyOn(window.vyotiq.settings, 'set');
    useSecondaryZoneStore.getState().setSettingsTab('shortcuts');
    expect(useSecondaryZoneStore.getState().settingsTab).toBe('shortcuts');
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ui: expect.objectContaining({ lastSettingsTab: 'shortcuts' }) })
    );
  });

  it('openSettings restores persisted tab when tab arg omitted', () => {
    useSecondaryZoneStore.getState().openSettings();
    expect(useSecondaryZoneStore.getState().settingsTab).toBe('memory');
  });
});
