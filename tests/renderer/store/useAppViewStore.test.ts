/**
 * App view store — full-screen settings vs chat.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppViewStore } from '@renderer/store/useAppViewStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useAttachmentPreviewStore } from '@renderer/store/useAttachmentPreviewStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';
beforeEach(() => {
  useAppViewStore.setState({
    view: 'chat',
    settingsSection: 'models-api',
    aboutOpen: false
  });
  useUiStore.setState({ dockExpanded: true, dockWidth: 260, collapsedWorkspaces: new Set(), hydrated: true });
  useDockSearchStore.setState({ open: true, query: 'tri' });
  useSettingsStore.setState({
    settings: { ui: { lastSettingsTab: 'agent-behavior' } }
  });
  useAttachmentPreviewStore.setState({ attachment: null });
});

describe('useAppViewStore', () => {
  it('closes other overlays when opening settings', () => {
    useAttachmentPreviewStore.getState().open({
      name: 'x.png',
      storedPath: 'a/x.png',
      mimeType: 'image/png'
    });
    useAppViewStore.getState().openSettings('appearance');
    expect(useAppViewStore.getState().view).toBe('settings');
    expect(useAppViewStore.getState().settingsSection).toBe('appearance');
    expect(useAttachmentPreviewStore.getState().attachment).toBeNull();
    expect(useUiStore.getState().dockExpanded).toBe(false);
    expect(useDockSearchStore.getState().open).toBe(false);
  });

  it('maps legacy context tab to models-api', () => {
    useAppViewStore.getState().openSettings('context' as never);
    expect(useAppViewStore.getState().settingsSection).toBe('models-api');
  });

  it('openSettings(about) opens settings with about', () => {
    useAppViewStore.getState().openSettings('about');
    expect(useAppViewStore.getState().view).toBe('settings');
    expect(useAppViewStore.getState().aboutOpen).toBe(true);
  });

  it('closes settings when opening attachment preview', () => {
    useAppViewStore.setState({ view: 'settings' });
    useAttachmentPreviewStore.getState().open({
      name: 'doc.pdf',
      storedPath: 'a/doc.pdf',
      mimeType: 'application/pdf'
    });
    expect(useAppViewStore.getState().view).toBe('chat');
    expect(useAttachmentPreviewStore.getState().attachment?.name).toBe('doc.pdf');
  });

  it('toggleSettings switches between chat and settings', () => {
    useAppViewStore.getState().toggleSettings();
    expect(useAppViewStore.getState().view).toBe('settings');
    useAppViewStore.getState().toggleSettings();
    expect(useAppViewStore.getState().view).toBe('chat');
  });

  it('setSettingsSection persists lastSettingsTab via settings IPC', async () => {
    const setSpy = vi.spyOn(window.vyotiq.settings, 'set');
    useAppViewStore.getState().setSettingsSection('agent-behavior');
    expect(useAppViewStore.getState().settingsSection).toBe('agent-behavior');
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ui: expect.objectContaining({ lastSettingsTab: 'agent-behavior' })
      })
    );
  });

  it('openSettings restores persisted section', () => {
    useAppViewStore.getState().openSettings();
    expect(useAppViewStore.getState().settingsSection).toBe('agent-behavior');
  });
});
