/**
 * Secondary zone overlay slot — settings panel only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSecondaryZoneStore } from '@renderer/store/useSecondaryZoneStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useAttachmentPreviewStore } from '@renderer/store/useAttachmentPreviewStore';
import { useFloatingLiveDiffStore } from '@renderer/store/useFloatingLiveDiffStore';

beforeEach(() => {
  useSecondaryZoneStore.setState({
    panel: null,
    settingsTab: 'providers'
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

  it('maps legacy context tab to providers', () => {
    useSecondaryZoneStore.getState().openSettings('context' as never);
    expect(useSecondaryZoneStore.getState().settingsTab).toBe('providers');
  });

  it('openSettings(about) opens settings with about tab', () => {
    useSecondaryZoneStore.getState().openSettings('about');
    expect(useSecondaryZoneStore.getState().panel).toBe('settings');
    expect(useSecondaryZoneStore.getState().settingsTab).toBe('about');
  });

  it('closes secondary panel when opening attachment preview', () => {
    useSecondaryZoneStore.setState({ panel: 'settings' });
    useAttachmentPreviewStore.getState().open({
      name: 'doc.pdf',
      storedPath: 'a/doc.pdf',
      mimeType: 'application/pdf'
    });
    expect(useSecondaryZoneStore.getState().panel).toBeNull();
    expect(useAttachmentPreviewStore.getState().attachment?.name).toBe('doc.pdf');
  });

  it('closeAllOverlays clears panel and companion overlays', () => {
    useSecondaryZoneStore.setState({ panel: 'settings' });
    useSecondaryZoneStore.getState().closeAllOverlays();
    expect(useSecondaryZoneStore.getState().panel).toBeNull();
  });

  it('setSettingsTab persists lastSettingsTab via settings IPC', async () => {
    const setSpy = vi.spyOn(window.vyotiq.settings, 'set');
    useSecondaryZoneStore.getState().setSettingsTab('memory');
    expect(useSecondaryZoneStore.getState().settingsTab).toBe('memory');
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ui: expect.objectContaining({ lastSettingsTab: 'memory' }) })
    );
  });

  it('openSettings restores persisted tab', () => {
    useSecondaryZoneStore.getState().openSettings();
    expect(useSecondaryZoneStore.getState().settingsTab).toBe('memory');
  });
});
