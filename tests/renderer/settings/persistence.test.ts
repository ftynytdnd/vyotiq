/**
 * Settings persistence — audit-sweep contract.
 *
 * Every persisted field on `AppSettings` (top-level + `AppSettings.ui`)
 * must reach `settings.json` via exactly one renderer-side setter that:
 *
 *   1. Emits an `IPC.SETTINGS_SET` (`vyotiq.settings.set`) round-trip,
 *      OR a debounced equivalent that is flushed by the same channel.
 *   2. Merges the returned shape into the local store cache so a
 *      subsequent read sees the post-write value WITHOUT a follow-up
 *      `vyotiq.settings.get`.
 *   3. Identity-skips a same-value re-write so a misclick on the
 *      current value does not churn `settings.json`.
 *
 * This file pins that contract for every field listed in the plan, so a
 * future refactor that accidentally drops persistence on one of them
 * fails here loudly instead of silently re-emerging months later.
 *
 * Notes on coverage scope:
 *   - The debounced `ui.dockExpanded` / `ui.collapsedWorkspaces` /
 *     `ui.filesExpandedWorkspaces` / `ui.expandedRows` writers are flushed explicitly via the
 *     `flushUiPersistence` / `flushTimelineUiPersistence` exports so we
 *     can assert against the IPC mock without sleeping.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import {
  useUiStore,
  flushUiPersistence
} from '@renderer/store/useUiStore';
import {
  useTimelineUiStore,
  flushTimelineUiPersistence
} from '@renderer/store/useTimelineUiStore';
import type { AppSettings } from '@shared/types/ipc';

function setSpy(): ReturnType<typeof vi.fn> {
  return window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  useSettingsStore.setState({
    settings: {},
    loading: false
  });
  useUiStore.setState({
    dockExpanded: true,
    dockWidth: 260,
    collapsedWorkspaces: new Set<string>(),
    filesExpandedWorkspaces: new Set<string>(),
    hydrated: true
  });
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
  // Echo back the patch so the store's local merge lands on the
  // post-write shape — same fixture pattern used by the other tests in
  // this folder.
  window.vyotiq.settings.set = vi.fn(async (patch) => patch as AppSettings) as never;
});

describe('AppSettings — top-level fields persist via useSettingsStore', () => {
  it('defaultModel: single IPC, cache merge, value reflected', async () => {
    await useSettingsStore
      .getState()
      .setDefaultModel({ providerId: 'p1', modelId: 'm1' });

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      defaultModel: { providerId: 'p1', modelId: 'm1' }
    });
    expect(useSettingsStore.getState().settings.defaultModel).toEqual({
      providerId: 'p1',
      modelId: 'm1'
    });
  });

});

describe('AppSettings.ui — per-workspace maps persist via useSettingsStore', () => {
  it('activeConversationByWorkspace: single IPC, cache merge', async () => {
    await useSettingsStore.getState().setActiveConversationByWorkspace({
      'ws-A': 'conv-1',
      'ws-B': 'conv-2'
    });

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { activeConversationByWorkspace: { 'ws-A': 'conv-1', 'ws-B': 'conv-2' } }
    });
    expect(
      useSettingsStore.getState().settings.ui?.activeConversationByWorkspace
    ).toEqual({ 'ws-A': 'conv-1', 'ws-B': 'conv-2' });
  });

  it('lastModelByWorkspace: single IPC, cache merge, identity-skip on same selection', async () => {
    await useSettingsStore
      .getState()
      .setLastModelByWorkspace('ws-A', { providerId: 'p1', modelId: 'm1' });
    expect(setSpy()).toHaveBeenCalledTimes(1);

    setSpy().mockClear();
    await useSettingsStore
      .getState()
      .setLastModelByWorkspace('ws-A', { providerId: 'p1', modelId: 'm1' });
    expect(setSpy()).not.toHaveBeenCalled();
  });

});

describe('AppSettings.ui — debounced fields persist via useUiStore + flush', () => {
  it('dockExpanded: toggleDock schedules a flush, flushUiPersistence drains it', async () => {
    useUiStore.getState().toggleDock();
    useUiStore.getState().toggleDock();
    flushUiPersistence();

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({ ui: { dockExpanded: true } });
  });

  it('dockWidth: setDockWidth schedules a flush, flushUiPersistence drains it', () => {
    useUiStore.getState().setDockWidth(300);
    flushUiPersistence();

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({ ui: { dockWidth: 300 } });
  });

  it('collapsedWorkspaces: toggleWorkspaceCollapsed schedules a flush, flushUiPersistence drains it', () => {
    useUiStore.getState().toggleWorkspaceCollapsed('ws-A');
    flushUiPersistence();

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { collapsedWorkspaces: ['ws-A'] }
    });

    // Toggle back off — the flusher writes the empty array.
    setSpy().mockClear();
    useUiStore.getState().toggleWorkspaceCollapsed('ws-A');
    flushUiPersistence();
    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { collapsedWorkspaces: [] }
    });
  });

  it('filesExpandedWorkspaces: setWorkspaceFilesExpanded schedules a flush, flushUiPersistence drains it', () => {
    useUiStore.getState().setWorkspaceFilesExpanded('ws-A', true);
    flushUiPersistence();

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { filesExpandedWorkspaces: ['ws-A'] }
    });

    setSpy().mockClear();
    useUiStore.getState().setWorkspaceFilesExpanded('ws-A', false);
    flushUiPersistence();
    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { filesExpandedWorkspaces: [] }
    });
  });
});

describe('AppSettings.ui — debounced fields persist via useTimelineUiStore + flush', () => {
  it('expandedRows: toggle schedules a flush, flushTimelineUiPersistence drains it', () => {
    useTimelineUiStore.getState().toggle('conv-1', 'tool-group:abc');
    flushTimelineUiPersistence();

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { expandedRows: { 'conv-1': ['tool-group:abc'] } }
    });
  });
});

describe('purgeWorkspaceFromUi: single IPC sweeps every per-workspace map', () => {
  it('strips ws-A from every per-workspace map and the collapsed array in one round-trip', async () => {
    useSettingsStore.setState({
      settings: {
        ui: {
          activeConversationByWorkspace: { 'ws-A': 'c1' },
          lastModelByWorkspace: { 'ws-A': { providerId: 'p', modelId: 'm' } },
          collapsedWorkspaces: ['ws-A'],
          filesExpandedWorkspaces: ['ws-A']
        }
      },
      loading: false
    });
    setSpy().mockClear();

    await useSettingsStore.getState().purgeWorkspaceFromUi('ws-A');

    expect(setSpy()).toHaveBeenCalledTimes(1);
    const ui = useSettingsStore.getState().settings.ui ?? {};
    expect('ws-A' in (ui.activeConversationByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.lastModelByWorkspace ?? {})).toBe(false);
    expect(ui.collapsedWorkspaces ?? []).not.toContain('ws-A');
    expect(ui.filesExpandedWorkspaces ?? []).not.toContain('ws-A');
  });
});

describe('filesExpandedWorkspaces: removed workspace id must not repersist on later toggle', () => {
  it('clearWorkspaceFilesExpanded + purge prevents stale in-memory id from flushing back', async () => {
    useUiStore.setState({
      filesExpandedWorkspaces: new Set(['ws-removed', 'ws-keep']),
      hydrated: true
    });
    useSettingsStore.setState({
      settings: {
        ui: { filesExpandedWorkspaces: ['ws-removed', 'ws-keep'] }
      },
      loading: false
    });

    useUiStore.getState().clearWorkspaceFilesExpanded('ws-removed');
    await useSettingsStore.getState().purgeWorkspaceFromUi('ws-removed');
    setSpy().mockClear();

    useUiStore.getState().toggleWorkspaceFilesExpanded('ws-keep');
    flushUiPersistence();

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { filesExpandedWorkspaces: [] }
    });

    setSpy().mockClear();
    useUiStore.getState().toggleWorkspaceFilesExpanded('ws-keep');
    flushUiPersistence();

    expect(setSpy()).toHaveBeenCalledTimes(1);
    expect(setSpy()).toHaveBeenCalledWith({
      ui: { filesExpandedWorkspaces: ['ws-keep'] }
    });
  });
});
