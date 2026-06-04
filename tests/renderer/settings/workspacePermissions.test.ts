/**

 * Settings store — effective permissions and workspace UI purge.

 */



import { describe, expect, it, beforeEach, vi } from 'vitest';

import { useSettingsStore, selectEffectivePermissions } from '@renderer/store/useSettingsStore';

import { DEFAULT_PERMISSIONS } from '@shared/constants';

import type { AppSettings } from '@shared/types/ipc';



beforeEach(() => {

  useSettingsStore.setState({

    settings: { permissions: { ...DEFAULT_PERMISSIONS } },

    loading: false

  });

  window.vyotiq.settings.set = vi.fn(async (patch) => patch as AppSettings) as never;

});



describe('selectEffectivePermissions', () => {

  it('falls back to DEFAULT_PERMISSIONS when nothing is configured', () => {

    expect(selectEffectivePermissions(null, {})).toEqual(DEFAULT_PERMISSIONS);

  });



  it('merges global permissions over defaults', () => {

    const got = selectEffectivePermissions(null, {

      permissions: { ...DEFAULT_PERMISSIONS }

    });

    expect(got).toEqual(DEFAULT_PERMISSIONS);

  });



  it('ignores deprecated per-workspace permission maps on disk', () => {

    const settings: AppSettings = {

      permissions: { ...DEFAULT_PERMISSIONS },

      ui: {

        permissionsByWorkspace: {

          'ws-A': { allowAuto: true } as never

        }

      }

    };

    expect(selectEffectivePermissions('ws-A', settings)).toEqual(DEFAULT_PERMISSIONS);

  });

});



describe('setPermissions', () => {

  it('persists global permissions and merges cache', async () => {

    await useSettingsStore.getState().setPermissions({});

    expect(useSettingsStore.getState().settings.permissions).toEqual(DEFAULT_PERMISSIONS);

    expect(window.vyotiq.settings.set).toHaveBeenCalled();

  });

});



describe('purgeWorkspaceFromUi', () => {

  it('strips active conversation, last model, and collapsed entries in one IPC call', async () => {

    useSettingsStore.setState({

      settings: {

        permissions: { ...DEFAULT_PERMISSIONS },

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

        permissions: { ...DEFAULT_PERMISSIONS },

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

