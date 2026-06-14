/**
 * Application settings store. Plain JSON, non-secret. Routes all reads/writes
 * through `settings/blob.ts` so the workspace state never silently overwrites
 * settings (and vice versa).
 *
 * Legacy `permissions` on disk are stripped on read/write (May 2026).
 */

import type { AppSettings } from '@shared/types/ipc.js';
import {
  mergeWorkspaceSpendStats,
  normalizeWorkspaceSpendEntry,
  type TurnUsageStatsDelta
} from '@shared/types/usageStats.js';
import { resolveSettingsSectionId } from '@shared/settings/settingsSection.js';
import { readBlob, updateBlob, type SettingsBlob } from './blob.js';
import { normalizeDockWidthInUi } from '@shared/dock/dockWidth.js';
import { normalizeWorkbenchPaneWidthInUi } from '@shared/workbench/workbenchPaneWidth.js';
import { migrateLegacyDockUi, normalizeSettingsPatch, stripRemovedContextManagementFields } from './migrateUiFields.js';
import { syncPromptCachingFromSettings } from './promptCachingRuntime.js';
import { syncVectorEmbedFromSettings } from './vectorEmbedRuntime.js';

export { normalizeSettingsPatch };

const DEFAULTS: AppSettings = {};

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

/**
 * One-time migration of the removed soft `tokenBudgetWarningTokens` field
 * into the new `agentBehavior.runTokenBudget`. We preserve the user's
 * previously-chosen ceiling so it pre-populates the new Run-limits control,
 * but leave the hard halt OFF: the legacy field only WARNED, so silently
 * converting it into a run-ending budget would change behavior without
 * consent. Runs once because `stripDeprecatedUiFields` then drops the
 * legacy key.
 */
function migrateLegacyTokenBudgetWarning<T extends Record<string, unknown>>(
  ui: T
): { ui: T; changed: boolean } {
  const legacy = ui['tokenBudgetWarningTokens'];
  if (typeof legacy !== 'number' || !Number.isFinite(legacy) || legacy <= 0) {
    return { ui, changed: false };
  }
  const agentBehavior = (ui['agentBehavior'] as Record<string, unknown> | undefined) ?? {};
  // Don't clobber an explicitly-configured budget.
  if (agentBehavior['runTokenBudget'] !== undefined) {
    return { ui, changed: false };
  }
  return {
    ui: {
      ...ui,
      agentBehavior: {
        ...agentBehavior,
        runTokenBudget: { enabled: false, maxTotalTokens: Math.round(legacy) }
      }
    },
    changed: true
  };
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

  if ('permissions' in next) {
    const { permissions: _legacyPerms, ...rest } = next as SettingsBlob & {
      permissions?: unknown;
    };
    void _legacyPerms;
    next = rest;
    changed = true;
  }

  const tab = next.ui?.lastSettingsTab;
  if (tab !== undefined) {
    const migrated = resolveSettingsSectionId(tab, 'models-api');
    if (migrated !== tab) {
      next = { ...next, ui: { ...(next.ui ?? {}), lastSettingsTab: migrated } };
      changed = true;
    }
  }

  if (next.ui) {
    const { ui: migrated, changed: dockMigrated } = migrateLegacyDockUi({
      ...next.ui
    } as Record<string, unknown>);
    const { ui: tokenMigrated, changed: tokenBudgetMigrated } =
      migrateLegacyTokenBudgetWarning(migrated);
    const agentBehaviorRaw = tokenMigrated['agentBehavior'];
    const { agentBehavior: cmStripped, changed: cmMigrated } =
      stripRemovedContextManagementFields(
        agentBehaviorRaw && typeof agentBehaviorRaw === 'object'
          ? (agentBehaviorRaw as Record<string, unknown>)
          : undefined
      );
    const tokenAndCmMigrated =
      cmMigrated && cmStripped
        ? { ...tokenMigrated, agentBehavior: cmStripped }
        : tokenMigrated;
    const stripped = stripDeprecatedUiFields(tokenAndCmMigrated);
    let ui = stripped;
    let uiChanged =
      dockMigrated || tokenBudgetMigrated || cmMigrated || stripped !== next.ui;
    if (ui.density === undefined) {
      ui = { ...ui, density: 'compact' };
      uiChanged = true;
    }
    const dock = normalizeDockWidthInUi(ui);
    if (dock.changed) {
      ui = dock.ui;
      uiChanged = true;
    }
    const pane = normalizeWorkbenchPaneWidthInUi(ui);
    if (pane.changed) {
      ui = pane.ui;
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
    permissions: _legacyPermissions,
    ...rest
  } = blob as SettingsBlob & { webSearchEndpoint?: string; permissions?: unknown };
  void _ws;
  void _wsList;
  void _activeWs;
  void _legacyWebSearch;
  void _legacyPermissions;

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
      lastSettingsTab: resolveSettingsSectionId(ui.lastSettingsTab, 'models-api')
    };
  }

  return {
    ...DEFAULTS,
    ...rest,
    ...(ui !== undefined ? { ui } : {})
  };
}

export async function getSettings(): Promise<AppSettings> {
  const raw = await readBlob();
  const { blob: normalized, changed } = normalizeBlobForPersistence(raw);
  const persisted = changed ? await updateBlob(() => normalized) : raw;
  const settings = publicShape(persisted);
  syncPromptCachingFromSettings(settings);
  syncVectorEmbedFromSettings(settings);
  return settings;
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  let normalized = normalizeSettingsPatch(patch);
  if (normalized.ui?.lastSettingsTab !== undefined) {
    const ui = patch.ui ?? {};
    normalized = {
      ...patch,
      ui: {
        ...ui,
        lastSettingsTab: resolveSettingsSectionId(ui.lastSettingsTab, 'models-api')
      }
    };
  }
  const next = await updateBlob((current) => {
    const {
      webSearchEndpoint: _dropWeb,
      contextSummary: _dropCs,
      permissions: _dropPerms,
      ...cleaned
    } = current as SettingsBlob & {
      webSearchEndpoint?: string;
      contextSummary?: unknown;
      permissions?: unknown;
    };
    void _dropWeb;
    void _dropCs;
    void _dropPerms;

    const currentUi = stripDeprecatedUiFields(
      migrateLegacyDockUi({ ...(cleaned.ui ?? {}) } as Record<string, unknown>).ui
    );

    const patchUi = normalized.ui
      ? stripDeprecatedUiFields(
          migrateLegacyDockUi({ ...normalized.ui } as Record<string, unknown>).ui
        )
      : undefined;

    const spendIncrement = patchUi?.workspaceSpendIncrement as
      | Record<string, number>
      | undefined;
    const usageIncrement = patchUi?.workspaceUsageIncrement as
      | Record<string, { spendUsd: number } & TurnUsageStatsDelta>
      | undefined;
    const patchUiSansIncrement = patchUi ? { ...patchUi } : undefined;
    if (patchUiSansIncrement) {
      if (spendIncrement !== undefined) delete patchUiSansIncrement.workspaceSpendIncrement;
      if (usageIncrement !== undefined) delete patchUiSansIncrement.workspaceUsageIncrement;
    }

    const mergedUi: Record<string, unknown> = {
      ...currentUi,
      ...(patchUiSansIncrement ?? {})
    };
    if (spendIncrement && Object.keys(spendIncrement).length > 0) {
      const prev = (currentUi.workspaceSpendUsd as Record<string, unknown> | undefined) ?? {};
      const nextSpend = { ...prev };
      for (const [workspaceId, delta] of Object.entries(spendIncrement)) {
        if (typeof delta === 'number' && Number.isFinite(delta) && delta > 0) {
          const base = normalizeWorkspaceSpendEntry(nextSpend[workspaceId] as never);
          nextSpend[workspaceId] = mergeWorkspaceSpendStats(base, delta);
        }
      }
      mergedUi.workspaceSpendUsd = nextSpend;
    }
    if (usageIncrement && Object.keys(usageIncrement).length > 0) {
      const prev = (currentUi.workspaceSpendUsd as Record<string, unknown> | undefined) ?? {};
      const nextUsage = { ...prev };
      for (const [workspaceId, delta] of Object.entries(usageIncrement)) {
        const spendUsd = delta.spendUsd;
        if (!Number.isFinite(spendUsd) || spendUsd <= 0) continue;
        const base = normalizeWorkspaceSpendEntry(nextUsage[workspaceId] as never);
        const { spendUsd: _s, ...stats } = delta;
        nextUsage[workspaceId] = mergeWorkspaceSpendStats(base, spendUsd, stats);
      }
      mergedUi.workspaceSpendUsd = nextUsage;
    }
    if (patchUi?.reports) {
      mergedUi.reports = {
        ...(currentUi.reports as Record<string, unknown> | undefined),
        ...patchUi.reports
      };
    }
    if (patchUi?.promptCaching) {
      mergedUi.promptCaching = {
        ...(currentUi.promptCaching as Record<string, unknown> | undefined),
        ...patchUi.promptCaching
      };
    }
    if (patchUi?.agentBehavior) {
      const agentPatch = patchUi.agentBehavior as NonNullable<AppSettings['ui']>['agentBehavior'];
      const prev = (currentUi.agentBehavior as Record<string, unknown> | undefined) ?? {};
      const nextAgent = { ...prev, ...agentPatch } as Record<string, unknown>;
      if (agentPatch?.runTokenBudget) {
        nextAgent.runTokenBudget = {
          ...(prev.runTokenBudget as Record<string, unknown> | undefined),
          ...agentPatch.runTokenBudget
        };
      }
      if (agentPatch?.runWallClockBudget) {
        nextAgent.runWallClockBudget = {
          ...(prev.runWallClockBudget as Record<string, unknown> | undefined),
          ...agentPatch.runWallClockBudget
        };
      }
      if (agentPatch?.contextCompaction) {
        nextAgent.contextCompaction = {
          ...(prev.contextCompaction as Record<string, unknown> | undefined),
          ...agentPatch.contextCompaction
        };
      }
      if (agentPatch?.contextManagement) {
        nextAgent.contextManagement = {
          ...(prev.contextManagement as Record<string, unknown> | undefined),
          ...agentPatch.contextManagement
        };
      }
      const { agentBehavior: cmStripped, changed: cmChanged } =
        stripRemovedContextManagementFields(nextAgent);
      mergedUi.agentBehavior = cmChanged && cmStripped ? cmStripped : nextAgent;
    }

    const { permissions: _patchPerms, ...normalizedSansPerms } = normalized as Partial<AppSettings> & {
      permissions?: unknown;
    };
    void _patchPerms;

    return {
      ...cleaned,
      ...normalizedSansPerms,
      // Deep-merge `ui` so a partial patch (e.g. just `dockExpanded` or legacy `sidebarOpen`)
      // doesn't clobber sibling fields written by other features.
      ui: mergedUi
    };
  });
  const settings = publicShape(next);
  syncPromptCachingFromSettings(settings);
  syncVectorEmbedFromSettings(settings);
  return settings;
}
