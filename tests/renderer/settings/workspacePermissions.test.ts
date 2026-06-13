/**
 * Settings store — workspace UI purge.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import type { AppSettings } from '@shared/types/ipc';

beforeEach(() => {
  useSettingsStore.setState({
    settings: {},
    loading: false
  });
  window.vyotiq.settings.set = vi.fn(async (patch) => patch as AppSettings) as never;
});

describe('purgeWorkspaceFromUi', () => {
  it('strips active conversation, last model, and collapsed entries in one IPC call', async () => {
    useSettingsStore.setState({
      settings: {
        ui: {
          activeConversationByWorkspace: { 'ws-A': 'c1', 'ws-B': 'c2' },
          lastModelByWorkspace: {
            'ws-A': { providerId: 'p', modelId: 'm' },
            'ws-B': { providerId: 'p', modelId: 'm2' }
          },
          collapsedWorkspaces: ['ws-A', 'ws-B']
        }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().purgeWorkspaceFromUi('ws-A');

    expect(setSpy).toHaveBeenCalledTimes(1);
    const ui = useSettingsStore.getState().settings.ui ?? {};
    expect('ws-A' in (ui.activeConversationByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.lastModelByWorkspace ?? {})).toBe(false);
    expect(ui.collapsedWorkspaces ?? []).not.toContain('ws-A');
    expect((ui.activeConversationByWorkspace ?? {})['ws-B']).toBe('c2');
    expect(ui.collapsedWorkspaces ?? []).toContain('ws-B');
  });

  it('is a no-op when the workspace has no tracked UI entries', async () => {
    useSettingsStore.setState({
      settings: {
        ui: { activeConversationByWorkspace: { 'ws-other': 'c1' } }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().purgeWorkspaceFromUi('ws-A');

    expect(setSpy).not.toHaveBeenCalled();
  });
});
