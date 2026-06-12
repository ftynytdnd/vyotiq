/**
 * Runtime shape gates for `settings:set` patches.
 */

import { DOCK_WIDTH_MAX, DOCK_WIDTH_MIN } from '@shared/dock/dockWidth.js';
import type { AppSettings } from '@shared/types/ipc.js';
import {
  assertBoolean,
  assertEnum,
  assertNumber,
  assertObject,
  assertString,
  assertStringArray
} from './validate.js';

const SETTINGS_TOP_KEYS = new Set(['defaultModel', 'permissions', 'ui']);

const UI_BOOLEAN_KEYS = ['sidebarOpen', 'dockExpanded', 'reducedMotion', 'firstLaunch'] as const;

const UI_NUMERIC_KEYS = ['dockWidth'] as const;

const UI_STRING_KEYS = ['theme', 'density', 'lastSettingsTab'] as const;

const UI_RECORD_KEYS = [
  'expandedRows',
  'activeConversationByWorkspace',
  'collapsedWorkspaces',
  'lastModelByWorkspace',
  'panelWidths',
  'pinnedConversationIds'
] as const;

const UI_NESTED_OBJECT_KEYS = ['reports', 'promptCaching', 'agentBehavior'] as const;

const REPORTS_BOOLEAN_KEYS = [
  'autoOpenReports',
  'openInAppBrowser',
  'promptForReportAfterEdits',
  'enableAiRunSummary'
] as const;

const PROMPT_CACHING_BOOLEAN_KEYS = [
  'anthropicCacheDiagnostics',
  'geminiExplicitCache'
] as const;

const PROMPT_CACHING_TTL_VALUES = ['5m', '1h'] as const;

const CONTEXT_MANAGEMENT_BOOLEAN_KEYS = ['enabled', 'summarizationEnabled'] as const;

const CONTEXT_MANAGEMENT_FRACTION_KEYS = [
  'triggerFraction',
  'warnFraction',
  'effectiveWindowFraction'
] as const;

const CONTEXT_MANAGEMENT_KEYS = [
  ...CONTEXT_MANAGEMENT_BOOLEAN_KEYS,
  ...CONTEXT_MANAGEMENT_FRACTION_KEYS,
  'keepLastToolResults',
  'cooldownMs',
  'minSavingsTokens'
] as const;

const THEME_VALUES = ['dark', 'light', 'system'] as const;
const DENSITY_VALUES = ['compact', 'balanced', 'airy'] as const;

/** Max keys per persisted `ui.*` record map — prevents unbounded merge. */
const UI_RECORD_MAX_KEYS = 256;

/** Max expanded row keys per conversation in `ui.expandedRows`. */
const EXPANDED_ROWS_MAX_PER_CONV = 512;

function assertRecordKeyCount(
  channel: string,
  field: string,
  record: Record<string, unknown>,
  maxKeys: number
): void {
  const n = Object.keys(record).length;
  if (n > maxKeys) {
    throw new Error(
      `${channel}: ${field} exceeds the ${maxKeys} key cap (received ${n})`
    );
  }
}

function assertUiPatch(channel: string, ui: Record<string, unknown>): void {
  for (const key of Object.keys(ui)) {
    const allowed =
      (UI_BOOLEAN_KEYS as readonly string[]).includes(key) ||
      (UI_NUMERIC_KEYS as readonly string[]).includes(key) ||
      (UI_STRING_KEYS as readonly string[]).includes(key) ||
      (UI_RECORD_KEYS as readonly string[]).includes(key) ||
      (UI_NESTED_OBJECT_KEYS as readonly string[]).includes(key) ||
      key === 'favoriteModels' ||
      key === 'workspaceSpendUsd' ||
      key === 'workspaceSpendIncrement';
    if (!allowed) {
      throw new Error(`${channel}: patch.ui.${key} is not a recognized ui field`);
    }
  }
  for (const k of UI_BOOLEAN_KEYS) {
    if (k in ui && ui[k] !== undefined) {
      assertBoolean(channel, `patch.ui.${k}`, ui[k]);
    }
  }
  for (const k of UI_NUMERIC_KEYS) {
    if (k in ui && ui[k] !== undefined) {
      assertNumber(channel, `patch.ui.${k}`, ui[k], {
        integer: true,
        min: DOCK_WIDTH_MIN,
        max: DOCK_WIDTH_MAX
      });
    }
  }
  for (const k of UI_STRING_KEYS) {
    if (k in ui && ui[k] !== undefined) {
      assertString(channel, `patch.ui.${k}`, ui[k]);
      if (k === 'theme') {
        assertEnum(channel, 'patch.ui.theme', ui[k], THEME_VALUES);
      }
      if (k === 'density') {
        assertEnum(channel, 'patch.ui.density', ui[k], DENSITY_VALUES);
      }
    }
  }
  if ('favoriteModels' in ui && ui.favoriteModels !== undefined) {
    assertStringArray(channel, 'patch.ui.favoriteModels', ui.favoriteModels, {
      maxItems: 64,
      maxBytes: 256
    });
  }
  if ('panelWidths' in ui && ui.panelWidths !== undefined) {
    assertObject(channel, 'patch.ui.panelWidths', ui.panelWidths);
    const map = ui.panelWidths as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.panelWidths', map, 16);
    for (const [panelId, w] of Object.entries(map)) {
      assertString(channel, 'patch.ui.panelWidths key', panelId);
      assertNumber(channel, `patch.ui.panelWidths[${panelId}]`, w, { integer: true, min: 320, max: 720 });
    }
  }
  if ('expandedRows' in ui && ui.expandedRows !== undefined) {
    assertObject(channel, 'patch.ui.expandedRows', ui.expandedRows);
    const rows = ui.expandedRows as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.expandedRows', rows, UI_RECORD_MAX_KEYS);
    for (const [convId, arr] of Object.entries(rows)) {
      assertString(channel, 'patch.ui.expandedRows key', convId);
      assertStringArray(channel, `patch.ui.expandedRows[${convId}]`, arr, {
        maxItems: EXPANDED_ROWS_MAX_PER_CONV
      });
    }
  }
  if ('activeConversationByWorkspace' in ui && ui.activeConversationByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.activeConversationByWorkspace', ui.activeConversationByWorkspace);
    const map = ui.activeConversationByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.activeConversationByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, convId] of Object.entries(map)) {
      assertString(channel, 'patch.ui.activeConversationByWorkspace key', wsId);
      assertString(channel, `patch.ui.activeConversationByWorkspace[${wsId}]`, convId);
    }
  }
  if ('collapsedWorkspaces' in ui && ui.collapsedWorkspaces !== undefined) {
    assertStringArray(channel, 'patch.ui.collapsedWorkspaces', ui.collapsedWorkspaces, {
      maxItems: UI_RECORD_MAX_KEYS
    });
  }
  if ('lastModelByWorkspace' in ui && ui.lastModelByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.lastModelByWorkspace', ui.lastModelByWorkspace);
    const map = ui.lastModelByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.lastModelByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, sel] of Object.entries(map)) {
      assertString(channel, 'patch.ui.lastModelByWorkspace key', wsId);
      assertObject(channel, `patch.ui.lastModelByWorkspace[${wsId}]`, sel);
      const s = sel as Record<string, unknown>;
      assertString(channel, `patch.ui.lastModelByWorkspace[${wsId}].providerId`, s.providerId);
      assertString(channel, `patch.ui.lastModelByWorkspace[${wsId}].modelId`, s.modelId);
    }
  }
  if ('workspaceSpendUsd' in ui && ui.workspaceSpendUsd !== undefined) {
    assertObject(channel, 'patch.ui.workspaceSpendUsd', ui.workspaceSpendUsd);
    const map = ui.workspaceSpendUsd as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.workspaceSpendUsd', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, spend] of Object.entries(map)) {
      assertString(channel, 'patch.ui.workspaceSpendUsd key', wsId);
      assertNumber(channel, `patch.ui.workspaceSpendUsd[${wsId}]`, spend, { min: 0, max: 1_000_000 });
    }
  }
  if ('workspaceSpendIncrement' in ui && ui.workspaceSpendIncrement !== undefined) {
    assertObject(channel, 'patch.ui.workspaceSpendIncrement', ui.workspaceSpendIncrement);
    const map = ui.workspaceSpendIncrement as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.workspaceSpendIncrement', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, delta] of Object.entries(map)) {
      assertString(channel, 'patch.ui.workspaceSpendIncrement key', wsId);
      assertNumber(channel, `patch.ui.workspaceSpendIncrement[${wsId}]`, delta, {
        min: 0,
        max: 1_000_000
      });
    }
  }
  if ('pinnedConversationIds' in ui && ui.pinnedConversationIds !== undefined) {
    assertStringArray(channel, 'patch.ui.pinnedConversationIds', ui.pinnedConversationIds, {
      maxItems: UI_RECORD_MAX_KEYS
    });
  }
  if ('reports' in ui && ui.reports !== undefined) {
    assertObject(channel, 'patch.ui.reports', ui.reports);
    const reports = ui.reports as Record<string, unknown>;
    for (const key of Object.keys(reports)) {
      if (!(REPORTS_BOOLEAN_KEYS as readonly string[]).includes(key)) {
        throw new Error(`${channel}: patch.ui.reports.${key} is not a recognized reports field`);
      }
    }
    for (const k of REPORTS_BOOLEAN_KEYS) {
      if (k in reports && reports[k] !== undefined) {
        assertBoolean(channel, `patch.ui.reports.${k}`, reports[k]);
      }
    }
  }
  if ('promptCaching' in ui && ui.promptCaching !== undefined) {
    assertObject(channel, 'patch.ui.promptCaching', ui.promptCaching);
    const promptCaching = ui.promptCaching as Record<string, unknown>;
    for (const key of Object.keys(promptCaching)) {
      const allowed =
        (PROMPT_CACHING_BOOLEAN_KEYS as readonly string[]).includes(key) ||
        key === 'anthropicCacheTtl';
      if (!allowed) {
        throw new Error(
          `${channel}: patch.ui.promptCaching.${key} is not a recognized promptCaching field`
        );
      }
    }
    for (const k of PROMPT_CACHING_BOOLEAN_KEYS) {
      if (k in promptCaching && promptCaching[k] !== undefined) {
        assertBoolean(channel, `patch.ui.promptCaching.${k}`, promptCaching[k]);
      }
    }
    if ('anthropicCacheTtl' in promptCaching && promptCaching.anthropicCacheTtl !== undefined) {
      assertEnum(
        channel,
        'patch.ui.promptCaching.anthropicCacheTtl',
        promptCaching.anthropicCacheTtl,
        PROMPT_CACHING_TTL_VALUES
      );
    }
  }
  if ('agentBehavior' in ui && ui.agentBehavior !== undefined) {
    assertObject(channel, 'patch.ui.agentBehavior', ui.agentBehavior);
    const agentBehavior = ui.agentBehavior as Record<string, unknown>;
    for (const key of Object.keys(agentBehavior)) {
      if (
        key !== 'runTokenBudget' &&
        key !== 'runWallClockBudget' &&
        key !== 'contextCompaction' &&
        key !== 'contextManagement'
      ) {
        throw new Error(
          `${channel}: patch.ui.agentBehavior.${key} is not a recognized agentBehavior field`
        );
      }
    }
    if ('runTokenBudget' in agentBehavior && agentBehavior.runTokenBudget !== undefined) {
      assertObject(channel, 'patch.ui.agentBehavior.runTokenBudget', agentBehavior.runTokenBudget);
      const budget = agentBehavior.runTokenBudget as Record<string, unknown>;
      for (const key of Object.keys(budget)) {
        if (key !== 'enabled' && key !== 'maxTotalTokens') {
          throw new Error(
            `${channel}: patch.ui.agentBehavior.runTokenBudget.${key} is not a recognized field`
          );
        }
      }
      if ('enabled' in budget && budget.enabled !== undefined) {
        assertBoolean(channel, 'patch.ui.agentBehavior.runTokenBudget.enabled', budget.enabled);
      }
      if ('maxTotalTokens' in budget && budget.maxTotalTokens !== undefined) {
        assertNumber(channel, 'patch.ui.agentBehavior.runTokenBudget.maxTotalTokens', budget.maxTotalTokens, {
          min: 10_000,
          max: 50_000_000
        });
      }
    }
    if ('runWallClockBudget' in agentBehavior && agentBehavior.runWallClockBudget !== undefined) {
      assertObject(
        channel,
        'patch.ui.agentBehavior.runWallClockBudget',
        agentBehavior.runWallClockBudget
      );
      const wall = agentBehavior.runWallClockBudget as Record<string, unknown>;
      for (const key of Object.keys(wall)) {
        if (key !== 'enabled' && key !== 'maxDurationMs') {
          throw new Error(
            `${channel}: patch.ui.agentBehavior.runWallClockBudget.${key} is not a recognized field`
          );
        }
      }
      if ('enabled' in wall && wall.enabled !== undefined) {
        assertBoolean(channel, 'patch.ui.agentBehavior.runWallClockBudget.enabled', wall.enabled);
      }
      if ('maxDurationMs' in wall && wall.maxDurationMs !== undefined) {
        assertNumber(channel, 'patch.ui.agentBehavior.runWallClockBudget.maxDurationMs', wall.maxDurationMs, {
          min: 60_000,
          max: 24 * 60 * 60 * 1000
        });
      }
    }
    if ('contextCompaction' in agentBehavior && agentBehavior.contextCompaction !== undefined) {
      assertObject(
        channel,
        'patch.ui.agentBehavior.contextCompaction',
        agentBehavior.contextCompaction
      );
      const compaction = agentBehavior.contextCompaction as Record<string, unknown>;
      if ('enabled' in compaction && compaction.enabled !== undefined) {
        assertBoolean(
          channel,
          'patch.ui.agentBehavior.contextCompaction.enabled',
          compaction.enabled
        );
      }
      for (const key of Object.keys(compaction)) {
        if (key !== 'enabled') {
          throw new Error(
            `${channel}: patch.ui.agentBehavior.contextCompaction.${key} is not a recognized field`
          );
        }
      }
    }
    if ('contextManagement' in agentBehavior && agentBehavior.contextManagement !== undefined) {
      assertObject(
        channel,
        'patch.ui.agentBehavior.contextManagement',
        agentBehavior.contextManagement
      );
      const cm = agentBehavior.contextManagement as Record<string, unknown>;
      for (const key of Object.keys(cm)) {
        if (!(CONTEXT_MANAGEMENT_KEYS as readonly string[]).includes(key)) {
          throw new Error(
            `${channel}: patch.ui.agentBehavior.contextManagement.${key} is not a recognized field`
          );
        }
      }
      for (const k of CONTEXT_MANAGEMENT_BOOLEAN_KEYS) {
        if (k in cm && cm[k] !== undefined) {
          assertBoolean(channel, `patch.ui.agentBehavior.contextManagement.${k}`, cm[k]);
        }
      }
      for (const k of CONTEXT_MANAGEMENT_FRACTION_KEYS) {
        if (k in cm && cm[k] !== undefined) {
          assertNumber(channel, `patch.ui.agentBehavior.contextManagement.${k}`, cm[k], {
            min: 0,
            max: 1
          });
        }
      }
      if ('keepLastToolResults' in cm && cm.keepLastToolResults !== undefined) {
        assertNumber(channel, 'patch.ui.agentBehavior.contextManagement.keepLastToolResults', cm.keepLastToolResults, {
          integer: true,
          min: 0,
          max: 20
        });
      }
      if ('cooldownMs' in cm && cm.cooldownMs !== undefined) {
        assertNumber(channel, 'patch.ui.agentBehavior.contextManagement.cooldownMs', cm.cooldownMs, {
          integer: true,
          min: 0,
          max: 5 * 60 * 1000
        });
      }
      if ('minSavingsTokens' in cm && cm.minSavingsTokens !== undefined) {
        assertNumber(channel, 'patch.ui.agentBehavior.contextManagement.minSavingsTokens', cm.minSavingsTokens, {
          integer: true,
          min: 0,
          max: 1_000_000
        });
      }
    }
  }
}

export function assertSettingsPatch(
  channel: string,
  patch: Partial<AppSettings>
): void {
  assertObject(channel, 'patch', patch);
  for (const key of Object.keys(patch)) {
    if (!SETTINGS_TOP_KEYS.has(key)) {
      throw new Error(`${channel}: patch.${key} is not a recognized settings field`);
    }
  }
  if ('defaultModel' in patch && patch.defaultModel !== undefined) {
    assertObject(channel, 'patch.defaultModel', patch.defaultModel);
    const dm = patch.defaultModel as Record<string, unknown>;
    assertString(channel, 'patch.defaultModel.providerId', dm.providerId);
    assertString(channel, 'patch.defaultModel.modelId', dm.modelId);
  }
  if ('permissions' in patch && patch.permissions !== undefined) {
    assertObject(channel, 'patch.permissions', patch.permissions);
    const p = patch.permissions as Record<string, unknown>;
    if ('allowAuto' in p && p.allowAuto !== undefined) {
      assertBoolean(channel, 'patch.permissions.allowAuto', p.allowAuto);
    }
  }
  if ('ui' in patch && patch.ui !== undefined) {
    assertObject(channel, 'patch.ui', patch.ui);
    assertUiPatch(channel, patch.ui as Record<string, unknown>);
  }
}
