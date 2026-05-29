/**
 * Runtime shape gates for `settings:set` patches.
 */

import type { AppSettings } from '@shared/types/ipc.js';
import {
  assertBoolean,
  assertEnum,
  assertNumber,
  assertObject,
  assertString,
  assertStringArray
} from './validate.js';

const SETTINGS_TOP_KEYS = new Set([
  'defaultModel',
  'contextSummary',
  'permissions',
  'webSearchEndpoint',
  'ui'
]);

const UI_BOOLEAN_KEYS = ['sidebarOpen', 'dockExpanded', 'reducedMotion', 'firstLaunch'] as const;

const UI_NUMERIC_KEYS = ['dockWidth'] as const;

const UI_STRING_KEYS = ['theme', 'density', 'lastSettingsTab', 'lastCheckpointsTab'] as const;

const UI_RECORD_KEYS = [
  'expandedRows',
  'activeConversationByWorkspace',
  'collapsedWorkspaces',
  'lastModelByWorkspace',
  'permissionsByWorkspace',
  'strictApprovalsByWorkspace',
  'gatePromptOnPendingByWorkspace',
  'approveAutoAcceptPendingByWorkspace',
  'gatePromptOnReviewRequestChangesByWorkspace',
  'contextSummaryByWorkspace',
  'tokenBudgetWarningByWorkspace',
  'panelWidths'
] as const;

const THEME_VALUES = ['dark', 'light', 'system'] as const;
const DENSITY_VALUES = ['compact', 'balanced', 'airy'] as const;
const CHECKPOINTS_TAB_VALUES = ['runs', 'files', 'review'] as const;

/** Absolute token count for the timeline budget-warning row (Settings → Context). */
const TOKEN_BUDGET_WARNING_MIN = 1_000;
const TOKEN_BUDGET_WARNING_MAX = 10_000_000;

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
      key === 'tokenBudgetWarningTokens' ||
      key === 'favoriteModels';
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
      assertNumber(channel, `patch.ui.${k}`, ui[k], { integer: true, min: 180, max: 320 });
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
      if (k === 'lastCheckpointsTab') {
        assertEnum(channel, 'patch.ui.lastCheckpointsTab', ui[k], CHECKPOINTS_TAB_VALUES);
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
  if ('permissionsByWorkspace' in ui && ui.permissionsByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.permissionsByWorkspace', ui.permissionsByWorkspace);
    const map = ui.permissionsByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.permissionsByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, entry] of Object.entries(map)) {
      assertString(channel, 'patch.ui.permissionsByWorkspace key', wsId);
      assertObject(channel, `patch.ui.permissionsByWorkspace[${wsId}]`, entry);
      const e = entry as Record<string, unknown>;
      if ('allowAuto' in e && e.allowAuto !== undefined) {
        assertBoolean(channel, `patch.ui.permissionsByWorkspace[${wsId}].allowAuto`, e.allowAuto);
      }
    }
  }
  if ('strictApprovalsByWorkspace' in ui && ui.strictApprovalsByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.strictApprovalsByWorkspace', ui.strictApprovalsByWorkspace);
    const map = ui.strictApprovalsByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.strictApprovalsByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, flag] of Object.entries(map)) {
      assertString(channel, 'patch.ui.strictApprovalsByWorkspace key', wsId);
      assertBoolean(channel, `patch.ui.strictApprovalsByWorkspace[${wsId}]`, flag);
    }
  }
  if ('gatePromptOnPendingByWorkspace' in ui && ui.gatePromptOnPendingByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.gatePromptOnPendingByWorkspace', ui.gatePromptOnPendingByWorkspace);
    const map = ui.gatePromptOnPendingByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.gatePromptOnPendingByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, flag] of Object.entries(map)) {
      assertString(channel, 'patch.ui.gatePromptOnPendingByWorkspace key', wsId);
      assertBoolean(channel, `patch.ui.gatePromptOnPendingByWorkspace[${wsId}]`, flag);
    }
  }
  if (
    'approveAutoAcceptPendingByWorkspace' in ui &&
    ui.approveAutoAcceptPendingByWorkspace !== undefined
  ) {
    assertObject(
      channel,
      'patch.ui.approveAutoAcceptPendingByWorkspace',
      ui.approveAutoAcceptPendingByWorkspace
    );
    const map = ui.approveAutoAcceptPendingByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(
      channel,
      'patch.ui.approveAutoAcceptPendingByWorkspace',
      map,
      UI_RECORD_MAX_KEYS
    );
    for (const [wsId, flag] of Object.entries(map)) {
      assertString(channel, 'patch.ui.approveAutoAcceptPendingByWorkspace key', wsId);
      assertBoolean(channel, `patch.ui.approveAutoAcceptPendingByWorkspace[${wsId}]`, flag);
    }
  }
  if (
    'gatePromptOnReviewRequestChangesByWorkspace' in ui &&
    ui.gatePromptOnReviewRequestChangesByWorkspace !== undefined
  ) {
    assertObject(
      channel,
      'patch.ui.gatePromptOnReviewRequestChangesByWorkspace',
      ui.gatePromptOnReviewRequestChangesByWorkspace
    );
    const map = ui.gatePromptOnReviewRequestChangesByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(
      channel,
      'patch.ui.gatePromptOnReviewRequestChangesByWorkspace',
      map,
      UI_RECORD_MAX_KEYS
    );
    for (const [wsId, flag] of Object.entries(map)) {
      assertString(channel, 'patch.ui.gatePromptOnReviewRequestChangesByWorkspace key', wsId);
      assertBoolean(
        channel,
        `patch.ui.gatePromptOnReviewRequestChangesByWorkspace[${wsId}]`,
        flag
      );
    }
  }
  if ('contextSummaryByWorkspace' in ui && ui.contextSummaryByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.contextSummaryByWorkspace', ui.contextSummaryByWorkspace);
    const map = ui.contextSummaryByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.contextSummaryByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const key of Object.keys(map)) {
      assertString(channel, 'patch.ui.contextSummaryByWorkspace key', key);
    }
  }
  if ('tokenBudgetWarningTokens' in ui && ui.tokenBudgetWarningTokens !== undefined) {
    assertNumber(channel, 'patch.ui.tokenBudgetWarningTokens', ui.tokenBudgetWarningTokens, {
      integer: true,
      min: TOKEN_BUDGET_WARNING_MIN,
      max: TOKEN_BUDGET_WARNING_MAX
    });
  }
  if ('tokenBudgetWarningByWorkspace' in ui && ui.tokenBudgetWarningByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.tokenBudgetWarningByWorkspace', ui.tokenBudgetWarningByWorkspace);
    const map = ui.tokenBudgetWarningByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.tokenBudgetWarningByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, tokens] of Object.entries(map)) {
      assertString(channel, 'patch.ui.tokenBudgetWarningByWorkspace key', wsId);
      assertNumber(channel, `patch.ui.tokenBudgetWarningByWorkspace[${wsId}]`, tokens, {
        integer: true,
        min: TOKEN_BUDGET_WARNING_MIN,
        max: TOKEN_BUDGET_WARNING_MAX
      });
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
  if ('webSearchEndpoint' in patch && patch.webSearchEndpoint !== undefined) {
    assertString(channel, 'patch.webSearchEndpoint', patch.webSearchEndpoint, {
      nonEmpty: false,
      maxBytes: 2048
    });
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
  if ('contextSummary' in patch && patch.contextSummary !== undefined) {
    assertObject(channel, 'patch.contextSummary', patch.contextSummary);
  }
  if ('ui' in patch && patch.ui !== undefined) {
    assertObject(channel, 'patch.ui', patch.ui);
    assertUiPatch(channel, patch.ui as Record<string, unknown>);
  }
}
