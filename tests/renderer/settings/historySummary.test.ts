/**
 * `historySummary.enabled` — store action (audit fix §2.2).
 *
 * Pins the renderer-side path that finally exposes the previously-
 * unsurfaced opt-in to the user:
 *
 *   - The action posts the wire-shape `{ historySummary: { enabled } }`
 *     to `vyotiq.settings.set` (NOT a top-level `enabled` boolean) so
 *     the wire shape stays open to additions like a max-tokens cap.
 *
 *   - The local cache reflects the persisted value on the way back.
 *
 *   - A same-value flip is identity-skipped — clicking the toggle
 *     onto its current value does NOT round-trip to main, so a
 *     misclick can't churn `settings.json` or briefly contend with
 *     a parallel writer.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { DEFAULT_PERMISSIONS } from '@shared/constants';
import type { AppSettings } from '@shared/types/ipc';

beforeEach(() => {
  useSettingsStore.setState({
    settings: { permissions: { ...DEFAULT_PERMISSIONS } },
    loading: false
  });
  // Echo back the patch so the store's local merge lands on the
  // post-write shape — same fixture pattern used by
  // `workspacePermissions.test.ts`.
  window.vyotiq.settings.set = vi.fn(async (patch) => patch as AppSettings) as never;
});

describe('useSettingsStore.setHistorySummaryEnabled', () => {
  it('persists `{ historySummary: { enabled: true } }` and reflects it locally', async () => {
    await useSettingsStore.getState().setHistorySummaryEnabled(true);

    expect(window.vyotiq.settings.set).toHaveBeenCalledWith({
      historySummary: { enabled: true }
    });
    expect(useSettingsStore.getState().settings.historySummary?.enabled).toBe(true);
  });

  it('persists `{ historySummary: { enabled: false } }` when toggled off', async () => {
    useSettingsStore.setState({
      settings: { historySummary: { enabled: true }, permissions: { ...DEFAULT_PERMISSIONS } },
      loading: false
    });
    (window.vyotiq.settings.set as unknown as { mockClear: () => void }).mockClear();

    await useSettingsStore.getState().setHistorySummaryEnabled(false);

    expect(window.vyotiq.settings.set).toHaveBeenCalledWith({
      historySummary: { enabled: false }
    });
    expect(useSettingsStore.getState().settings.historySummary?.enabled).toBe(false);
  });

  it('identity-skips a same-value flip (no IPC round-trip)', async () => {
    useSettingsStore.setState({
      settings: { historySummary: { enabled: true }, permissions: { ...DEFAULT_PERMISSIONS } },
      loading: false
    });
    (window.vyotiq.settings.set as unknown as { mockClear: () => void }).mockClear();

    await useSettingsStore.getState().setHistorySummaryEnabled(true);

    expect(window.vyotiq.settings.set).not.toHaveBeenCalled();
  });

  it('treats an unset historySummary as disabled (a fresh settings file flips cleanly to off→off no-op)', async () => {
    // No `historySummary` block at all — the legacy default. A flip to
    // `false` should be a no-op (current === enabled === false).
    expect(useSettingsStore.getState().settings.historySummary).toBeUndefined();
    (window.vyotiq.settings.set as unknown as { mockClear: () => void }).mockClear();

    await useSettingsStore.getState().setHistorySummaryEnabled(false);

    expect(window.vyotiq.settings.set).not.toHaveBeenCalled();
  });
});
