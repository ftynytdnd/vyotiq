/**
 * Settings hydration waits for the first `settings.get` before applying UI prefs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore, selectSettingsReady } from '@renderer/store/useSettingsStore';
import { useUiStore } from '@renderer/store/useUiStore';

let resolveGet!: (value: {
  ui: { dockExpanded: boolean; collapsedWorkspaces: string[] };
}) => void;

beforeEach(() => {
  useSettingsStore.setState({
    settings: {},
    loading: false,
    initialLoadDone: false
  });
  useUiStore.setState({ hydrated: false, dockExpanded: false, collapsedWorkspaces: new Set() });

  const getPromise = new Promise<{
    ui: { dockExpanded: boolean; collapsedWorkspaces: string[] };
  }>((resolve) => {
    resolveGet = resolve;
  });

  (window.vyotiq as unknown as { settings: object }).settings = {
    get: vi.fn(() => getPromise),
    set: vi.fn(async () => ({}))
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selectSettingsReady', () => {
  it('is false until the first refresh completes', async () => {
    const refresh = useSettingsStore.getState().refresh;
    void refresh();
    expect(selectSettingsReady(useSettingsStore.getState())).toBe(false);

    resolveGet({
      ui: { dockExpanded: true, collapsedWorkspaces: ['ws-a'] }
    });
    await vi.waitFor(() =>
      expect(selectSettingsReady(useSettingsStore.getState())).toBe(true)
    );
    expect(useSettingsStore.getState().settings.ui?.dockExpanded).toBe(true);
  });
});
