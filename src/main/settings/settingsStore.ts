/**
 * Application settings store. Plain JSON, non-secret. Routes all reads/writes
 * through `settings/blob.ts` so the workspace state never silently overwrites
 * settings (and vice versa).
 *
 * Permissions migration (May 2026): legacy permission flags on disk are
 * stripped on read — mutating tools no longer gate on user approval.
 */

import type { AppSettings } from '@shared/types/ipc.js';
import type { ChatPermissions } from '@shared/types/chat.js';
import { DEFAULT_PERMISSIONS } from '@shared/constants.js';
import { migrateLastSettingsTab } from '@shared/settings/settingsGroups.js';
import { readBlob, updateBlob, type SettingsBlob } from './blob.js';
import { migrateLegacyDockUi, normalizeSettingsPatch } from './migrateUiFields.js';

export { normalizeSettingsPatch };

const DEFAULTS: AppSettings = { permissions: DEFAULT_PERMISSIONS };

/**
 * Legacy permissions shape carried by pre-2026 settings.json files. The
 * fields are optional individually because partial workspace-override
 * entries (e.g. `{ allowBash: false }`) are valid too.
 */
interface LegacyPermissions {
  allowFileWrites?: boolean;
  allowBash?: boolean;
  allowWebSearch?: boolean;
}

function derivePermissions(
  _raw: (LegacyPermissions & Partial<{ allowAuto: boolean }>) | undefined
): ChatPermissions {
  return { ...DEFAULT_PERMISSIONS };
}

/**
 * One-time on-disk cleanup for deprecated top-level / ui fields.
 * Called from `getSettings` so legacy values are rewritten before the
 * next explicit user save.
 */
function stripDeprecatedUiFields<T extends Record<string, unknown>>(ui: T): T {
  const {
    permissionsByWorkspace: _p,
    strictApprovalsByWorkspace: _s,
    gatePromptOnPendingByWorkspace: _g,
    approveAutoAcceptPendingByWorkspace: _a,
    gatePromptOnReviewRequestChangesByWorkspace: _r,
    lastCheckpointsTab: _c,
    contextSummaryByWorkspace: _cs,
    tokenBudgetWarningTokens: _tb,
    tokenBudgetWarningByWorkspace: _tbw,
    sidebarVisible: _sidebarVisible,
    sidebarWidth: _sidebarWidth,
    ...rest
  } = ui;
  void _p;
  void _s;
  void _g;
  void _a;
  void _r;
  void _c;
  void _cs;
  void _tb;
  void _tbw;
  void _sidebarVisible;
  void _sidebarWidth;
  return rest as T;
}

function normalizeBlobForPersistence(blob: SettingsBlob): { blob: SettingsBlob; changed: boolean } {
  let changed = false;
  let next: SettingsBlob = { ...blob };

  if ('webSearchEndpoint' in next) {
    const { webSearchEndpoint: _legacy, ...rest } = next as SettingsBlob & {
      webSearchEndpoint?: string;
    };
    void _legacy;
    next = rest;
    changed = true;
  }

  if ('contextSummary' in next) {
    const { contextSummary: _legacyCs, ...rest } = next as SettingsBlob & {
      contextSummary?: unknown;
    };
    void _legacyCs;
    next = rest;
    changed = true;
  }

  const tab = next.ui?.lastSettingsTab;
  if (tab !== undefined) {
    const migrated = migrateLastSettingsTab(tab, 'setup');
    if (migrated !== tab) {
      next = { ...next, ui: { ...(next.ui ?? {}), lastSettingsTab: migrated } };
      changed = true;
    }
  }

  if (next.ui) {
    const { ui: migrated, changed: dockMigrated } = migrateLegacyDockUi({
      ...next.ui
    } as Record<string, unknown>);
    const stripped = stripDeprecatedUiFields(migrated);
    let ui = stripped;
    let uiChanged = dockMigrated || stripped !== next.ui;
    if (ui.density === undefined) {
      ui = { ...ui, density: 'compact' };
      uiChanged = true;
    }
    if (uiChanged) {
      next = { ...next, ui };
      changed = true;
    }
  } else {
    next = { ...next, ui: { density: 'compact' } };
    changed = true;
  }

  return { blob: next, changed };
}

function publicShape(blob: SettingsBlob): AppSettings {
  // Strip internal-only fields.
  // are surfaced to the renderer via `vyotiq.workspace.list()`, not
  // through the generic settings IPC, so they have no business
  // appearing in `AppSettings`.
  const {
    workspacePath: _ws,
    workspaces: _wsList,
    activeWorkspaceId: _activeWs,
    webSearchEndpoint: _legacyWebSearch,
    ...rest
  } = blob as SettingsBlob & { webSearchEndpoint?: string };
  void _ws;
  void _wsList;
  void _activeWs;
  void _legacyWebSearch;

  // Derive the new-shape `permissions` block from whichever shape the
  // on-disk blob carries. The raw read may still have the legacy
  // three booleans; `derivePermissions` collapses them.
  const permissions = derivePermissions(
    rest.permissions as
    | (LegacyPermissions & Partial<{ allowAuto: boolean }>)
    | undefined
  );

  let ui = rest.ui ? { ...rest.ui } : rest.ui;
  if (ui) {
    ui = migrateLegacyDockUi({ ...ui } as Record<string, unknown>).ui as typeof ui;
    const {
      permissionsByWorkspace: _p,
      strictApprovalsByWorkspace: _s,
      gatePromptOnPendingByWorkspace: _g,
      approveAutoAcceptPendingByWorkspace: _a,
      gatePromptOnReviewRequestChangesByWorkspace: _r,
      lastCheckpointsTab: _c,
      contextSummaryByWorkspace: _cs,
      tokenBudgetWarningTokens: _tb,
      tokenBudgetWarningByWorkspace: _tbw,
      ...cleanUi
    } = ui as typeof ui & Record<string, unknown>;
    void _p;
    void _s;
    void _g;
    void _a;
    void _r;
    void _c;
    void _cs;
    void _tb;
    void _tbw;
    ui = cleanUi;
  }

  if (ui?.lastSettingsTab !== undefined) {
    ui = {
      ...ui,
      lastSettingsTab: migrateLastSettingsTab(ui.lastSettingsTab, 'setup')
    };
  }

  return {
    ...DEFAULTS,
    ...rest,
    permissions,
    ...(ui !== undefined ? { ui } : {})
  };
}

export async function getSettings(): Promise<AppSettings> {
  const raw = await readBlob();
  const { blob: normalized, changed } = normalizeBlobForPersistence(raw);
  const persisted = changed ? await updateBlob(() => normalized) : raw;
  return publicShape(persisted);
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  let normalized = normalizeSettingsPatch(patch);
  if (normalized.ui?.lastSettingsTab !== undefined) {
    const ui = patch.ui ?? {};
    normalized = {
      ...patch,
      ui: {
        ...ui,
        lastSettingsTab: migrateLastSettingsTab(ui.lastSettingsTab, 'setup')
      }
    };
  }
  const next = await updateBlob((current) => {
    const {
      webSearchEndpoint: _dropWeb,
      contextSummary: _dropCs,
      ...cleaned
    } = current as SettingsBlob & {
      webSearchEndpoint?: string;
      contextSummary?: unknown;
    };
    void _dropWeb;
    void _dropCs;
    // so legacy keys (`allowFileWrites` etc.) don't leak into the
    // post-write shape. The patch is already new-shape per the
    // updated `AppSettings.permissions` type.
    const migratedPermissions = derivePermissions(
      cleaned.permissions as
      | (LegacyPermissions & Partial<{ allowAuto: boolean }>)
      | undefined
    );

    const currentUi = stripDeprecatedUiFields(
      migrateLegacyDockUi({ ...(cleaned.ui ?? {}) } as Record<string, unknown>).ui
    );

    const patchUi = normalized.ui
      ? stripDeprecatedUiFields(
          migrateLegacyDockUi({ ...normalized.ui } as Record<string, unknown>).ui
        )
      : undefined;

    return {
      ...cleaned,
      ...normalized,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        ...migratedPermissions,
        ...(normalized.permissions ?? {})
      },
      // Deep-merge `ui` so a partial patch (e.g. just `dockExpanded` or legacy `sidebarOpen`)
      // doesn't clobber sibling fields written by other features.
      ui: {
        ...currentUi,
        ...(patchUi ?? {})
      }
    };
  });
  return publicShape(next);
}
