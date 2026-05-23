/**
 * Per-workspace permissions — selector + store actions (Part C).
 *
 * Scope:
 *   - `selectEffectivePermissions`: layered fallback (defaults → global
 *      → per-workspace).
 *   - `setPermissionsForWorkspace`: writes only the patched flags into
 *      the workspace's entry, leaves siblings untouched.
 *   - `clearWorkspacePermissions`: drops the entire entry so the next
 *      send falls through to the global block.
 *   - `purgeWorkspaceFromUi`: cascade triggered by `workspace.remove`
 *      strips the id from every per-workspace UI map in one shot.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  useSettingsStore,
  selectEffectivePermissions,
  workspaceHasPermissionOverride
} from '@renderer/store/useSettingsStore';
import { DEFAULT_PERMISSIONS } from '@shared/constants';
import type { AppSettings } from '@shared/types/ipc';

beforeEach(() => {
  useSettingsStore.setState({
    settings: { permissions: { ...DEFAULT_PERMISSIONS } },
    loading: false
  });
  // Echo the patch back so the store's local cache lands on the
  // post-write shape. Lets a single test sequence multiple writes
  // (e.g. set → set → clear) without re-stubbing between calls.
  window.vyotiq.settings.set = vi.fn(async (patch) => patch as AppSettings) as never;
});

describe('selectEffectivePermissions — layered fallback', () => {
  it('falls back to DEFAULT_PERMISSIONS when nothing is configured', () => {
    const got = selectEffectivePermissions(null, {});
    expect(got).toEqual(DEFAULT_PERMISSIONS);
  });

  it('layers global over defaults', () => {
    const got = selectEffectivePermissions(null, {
      permissions: { ...DEFAULT_PERMISSIONS, allowAuto: true }
    });
    expect(got.allowAuto).toBe(true);
  });

  it('layers per-workspace over global', () => {
    const settings: AppSettings = {
      permissions: { ...DEFAULT_PERMISSIONS, allowAuto: false },
      ui: {
        permissionsByWorkspace: {
          'ws-A': { allowAuto: true }
        }
      }
    };
    // ws-A: allowAuto flipped on by the per-workspace override.
    const wsA = selectEffectivePermissions('ws-A', settings);
    expect(wsA).toEqual({ allowAuto: true });
    // ws-B has no override — inherits from global (allowAuto: false).
    const wsB = selectEffectivePermissions('ws-B', settings);
    expect(wsB.allowAuto).toBe(false);
    // null skips the per-workspace layer entirely.
    const fallback = selectEffectivePermissions(null, settings);
    expect(fallback.allowAuto).toBe(false);
  });

  it('workspaceHasPermissionOverride is true only for ids with non-empty entries', () => {
    const settings: AppSettings = {
      ui: {
        permissionsByWorkspace: {
          'ws-A': { allowAuto: true },
          'ws-empty': {}
        }
      }
    };
    expect(workspaceHasPermissionOverride('ws-A', settings)).toBe(true);
    expect(workspaceHasPermissionOverride('ws-empty', settings)).toBe(false);
    expect(workspaceHasPermissionOverride('ws-missing', settings)).toBe(false);
    expect(workspaceHasPermissionOverride(null, settings)).toBe(false);
  });
});

describe('setPermissionsForWorkspace / clearWorkspacePermissions', () => {
  it('writes a partial override and leaves sibling workspaces untouched', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          permissionsByWorkspace: {
            'ws-other': { allowAuto: true }
          }
        }
      },
      loading: false
    });

    await useSettingsStore
      .getState()
      .setPermissionsForWorkspace('ws-A', { allowAuto: true });

    const map = useSettingsStore.getState().settings.ui?.permissionsByWorkspace ?? {};
    expect(map['ws-A']).toEqual({ allowAuto: true });
    expect(map['ws-other']).toEqual({ allowAuto: true });
  });

  it('overwrites an existing override with the new value', async () => {
    // The single-flag shape collapses what used to be a partial-merge
    // contract: there's only one key now, so a follow-up write is
    // always an overwrite of `allowAuto`. Locking that here so a
    // future re-introduction of partial fields makes the test fail
    // loudly rather than silently breaking the merge.
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          permissionsByWorkspace: { 'ws-A': { allowAuto: true } }
        }
      },
      loading: false
    });

    await useSettingsStore
      .getState()
      .setPermissionsForWorkspace('ws-A', { allowAuto: false });

    const entry = useSettingsStore.getState().settings.ui?.permissionsByWorkspace?.['ws-A'];
    expect(entry).toEqual({ allowAuto: false });
  });

  it('skips the IPC entirely when the merge is a no-op', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          permissionsByWorkspace: { 'ws-A': { allowAuto: true } }
        }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    // Toggle allowAuto to its CURRENT value — the store's identity-skip
    // branch must short-circuit so we don't churn settings.json on a
    // misclick that lands on the same value.
    await useSettingsStore
      .getState()
      .setPermissionsForWorkspace('ws-A', { allowAuto: true });

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('clearWorkspacePermissions drops the entry entirely', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          permissionsByWorkspace: {
            'ws-A': { allowAuto: true },
            'ws-B': { allowAuto: false }
          }
        }
      },
      loading: false
    });

    await useSettingsStore.getState().clearWorkspacePermissions('ws-A');

    const map = useSettingsStore.getState().settings.ui?.permissionsByWorkspace ?? {};
    expect('ws-A' in map).toBe(false);
    expect(map['ws-B']).toEqual({ allowAuto: false });
  });

  it('clearWorkspacePermissions is a no-op for unknown ids (does not call set)', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: { permissionsByWorkspace: {} }
      },
      loading: false
    });
    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().clearWorkspacePermissions('ws-missing');

    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe('purgeWorkspaceFromUi — cascade on workspace.remove', () => {
  it('strips the id from every per-workspace UI map in one IPC call', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          activeConversationByWorkspace: { 'ws-A': 'c1', 'ws-B': 'c2' },
          lastModelByWorkspace: {
            'ws-A': { providerId: 'p', modelId: 'm' },
            'ws-B': { providerId: 'p', modelId: 'm2' }
          },
          permissionsByWorkspace: {
            'ws-A': { allowAuto: true },
            'ws-B': { allowAuto: false }
          },
          strictApprovalsByWorkspace: { 'ws-A': true, 'ws-B': false },
          gatePromptOnPendingByWorkspace: { 'ws-A': true, 'ws-B': true },
          collapsedWorkspaces: ['ws-A', 'ws-B']
        }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().purgeWorkspaceFromUi('ws-A');

    // Single IPC round-trip — purge is meant to be ONE write, not
    // six, so a removed workspace doesn't fan out into a flurry of
    // settings.json churn.
    expect(setSpy).toHaveBeenCalledTimes(1);
    const ui = useSettingsStore.getState().settings.ui ?? {};
    expect('ws-A' in (ui.activeConversationByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.lastModelByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.permissionsByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.strictApprovalsByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.gatePromptOnPendingByWorkspace ?? {})).toBe(false);
    expect(ui.collapsedWorkspaces ?? []).not.toContain('ws-A');
    // Sibling workspace untouched in every map.
    expect((ui.activeConversationByWorkspace ?? {})['ws-B']).toBe('c2');
    expect((ui.lastModelByWorkspace ?? {})['ws-B']).toEqual({
      providerId: 'p',
      modelId: 'm2'
    });
    expect((ui.permissionsByWorkspace ?? {})['ws-B']).toEqual({ allowAuto: false });
    expect((ui.strictApprovalsByWorkspace ?? {})['ws-B']).toBe(false);
    expect((ui.gatePromptOnPendingByWorkspace ?? {})['ws-B']).toBe(true);
    expect(ui.collapsedWorkspaces ?? []).toContain('ws-B');
  });

  it('strips entries from strictApprovals / gate / collapsed even when permission maps are clean', async () => {
    // Regression for the P0 bug: pre-fix, purgeWorkspaceFromUi only
    // touched three maps, so a workspace whose only persisted state was
    // a strict-approvals toggle (or a collapsed-sidebar entry) would
    // leak that id into settings.json forever. The new short-circuit
    // must trip on ANY of the six maps, and the patch must clear all of
    // them in one round-trip.
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          strictApprovalsByWorkspace: { 'ws-A': true },
          gatePromptOnPendingByWorkspace: { 'ws-A': true },
          collapsedWorkspaces: ['ws-A']
        }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().purgeWorkspaceFromUi('ws-A');

    expect(setSpy).toHaveBeenCalledTimes(1);
    const ui = useSettingsStore.getState().settings.ui ?? {};
    expect('ws-A' in (ui.strictApprovalsByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.gatePromptOnPendingByWorkspace ?? {})).toBe(false);
    expect(ui.collapsedWorkspaces ?? []).not.toContain('ws-A');
  });

  it('is a no-op when the workspace has no UI entries (no IPC fired)', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          activeConversationByWorkspace: { 'ws-other': 'c1' }
        }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().purgeWorkspaceFromUi('ws-A');

    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe('setStrictApprovalsForWorkspace / setGatePromptOnPendingForWorkspace', () => {
  it('strict: writes the flag, preserves sibling entries, single IPC', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          strictApprovalsByWorkspace: { 'ws-other': true }
        }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().setStrictApprovalsForWorkspace('ws-A', true);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const map = useSettingsStore.getState().settings.ui?.strictApprovalsByWorkspace ?? {};
    expect(map['ws-A']).toBe(true);
    expect(map['ws-other']).toBe(true);
  });

  it('strict: identity-skips a same-value re-toggle (no IPC)', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          strictApprovalsByWorkspace: { 'ws-A': true }
        }
      },
      loading: false
    });
    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().setStrictApprovalsForWorkspace('ws-A', true);

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('strict: treats missing entry as false for identity-skip', async () => {
    // Setting an unknown workspace's flag to `false` should be a no-op
    // because the effective value is already `false` (absence == off).
    // This stops a fresh workspace from getting a `{ id: false }` entry
    // baked into settings.json from a single misclick.
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {}
      },
      loading: false
    });
    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().setStrictApprovalsForWorkspace('ws-A', false);

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('gate: writes the flag, preserves sibling entries, single IPC', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          gatePromptOnPendingByWorkspace: { 'ws-other': true }
        }
      },
      loading: false
    });

    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().setGatePromptOnPendingForWorkspace('ws-A', true);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const map = useSettingsStore.getState().settings.ui?.gatePromptOnPendingByWorkspace ?? {};
    expect(map['ws-A']).toBe(true);
    expect(map['ws-other']).toBe(true);
  });

  it('gate: identity-skips a same-value re-toggle (no IPC)', async () => {
    useSettingsStore.setState({
      settings: {
        permissions: { ...DEFAULT_PERMISSIONS },
        ui: {
          gatePromptOnPendingByWorkspace: { 'ws-A': true }
        }
      },
      loading: false
    });
    const setSpy = window.vyotiq.settings.set as unknown as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    await useSettingsStore.getState().setGatePromptOnPendingForWorkspace('ws-A', true);

    expect(setSpy).not.toHaveBeenCalled();
  });
});
