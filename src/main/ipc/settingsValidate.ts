/**
 * Runtime shape gates for `settings:set` patches.
 */

import {
  DOCK_WIDTH_MAX,
  DOCK_WIDTH_MIN
} from '@shared/dock/dockWidth.js';
import {
  WORKBENCH_PANE_WIDTH_MAX,
  WORKBENCH_PANE_WIDTH_MIN
} from '@shared/workbench/workbenchPaneWidth.js';
import type { AppSettings } from '@shared/types/ipc.js';
import {
  assertBoolean,
  assertEnum,
  assertNumber,
  assertObject,
  assertString,
  assertStringArray
} from './validate.js';

const SETTINGS_TOP_KEYS = new Set(['defaultModel', 'ui']);

const UI_BOOLEAN_KEYS = ['sidebarOpen', 'dockExpanded', 'reducedMotion', 'firstLaunch'] as const;

const UI_NUMERIC_KEYS = ['dockWidth', 'workbenchPaneWidth'] as const;

const UI_NUMERIC_BOUNDS: Record<(typeof UI_NUMERIC_KEYS)[number], { min: number; max: number }> = {
  dockWidth: { min: DOCK_WIDTH_MIN, max: DOCK_WIDTH_MAX },
  workbenchPaneWidth: { min: WORKBENCH_PANE_WIDTH_MIN, max: WORKBENCH_PANE_WIDTH_MAX }
};

const UI_STRING_KEYS = ['theme', 'density', 'lastSettingsTab'] as const;

const UI_RECORD_KEYS = [
  'expandedRows',
  'activeConversationByWorkspace',
  'collapsedWorkspaces',
  'filesExpandedWorkspaces',
  'lastModelByWorkspace',
  'panelWidths',
  'pinnedConversationIds',
  'keybindings',
  'recentEditorFilesByWorkspace',
  'fileTreeExpandedByWorkspace',
  'editorTabsByWorkspace'
] as const;

const UI_NESTED_OBJECT_KEYS = [
  'reports',
  'promptCaching',
  'inlineCompletion',
  'vectorMemory',
  'editorLsp',
  'agentBehavior',
  'capture'
] as const;

const CAPTURE_BOOLEAN_KEYS = ['redactWindowTitles'] as const;

const REPORTS_BOOLEAN_KEYS = [
  'autoOpenReports',
  'openInAppBrowser',
  'promptForReportAfterEdits',
  'enableAiRunSummary'
] as const;

const PROMPT_CACHING_BOOLEAN_KEYS = [
  'anthropicCacheDiagnostics',
  'geminiExplicitCache',
  'openaiExtendedCacheRetention'
] as const;

const PROMPT_CACHING_TTL_VALUES = ['5m', '1h'] as const;

const CONTEXT_MANAGEMENT_BOOLEAN_KEYS = [
  'enabled',
  'summarizationEnabled',
  'serverSideCompaction'
] as const;

const CONTEXT_MANAGEMENT_FRACTION_KEYS = ['triggerFraction', 'warnFraction'] as const;

const CONTEXT_MANAGEMENT_KEYS = [
  ...CONTEXT_MANAGEMENT_BOOLEAN_KEYS,
  ...CONTEXT_MANAGEMENT_FRACTION_KEYS,
  'keepLastToolResults',
  'cooldownMs',
  'minSavingsTokens',
  'summaryModel'
] as const;

const THEME_VALUES = ['dark', 'light', 'system'] as const;
const DENSITY_VALUES = ['compact', 'balanced', 'airy'] as const;

/** Max keys per persisted `ui.*` record map — prevents unbounded merge. */
const UI_RECORD_MAX_KEYS = 256;

/** Max expanded row keys per conversation in `ui.expandedRows`. */
const EXPANDED_ROWS_MAX_PER_CONV = 512;

/** Max recent editor paths per workspace in `ui.recentEditorFilesByWorkspace`. */
const RECENT_EDITOR_FILES_MAX_PER_WS = 8;

/** Max expanded folder paths per workspace in `ui.fileTreeExpandedByWorkspace`. */
const FILE_TREE_EXPANDED_MAX_PER_WS = 512;

const EDITOR_TABS_MAX_PER_WS = 20;

const USAGE_INCREMENT_FIELDS = new Set([
  'spendUsd',
  'netCacheSavingsUsd',
  'cachedTokens',
  'reasoningTokens',
  'lastCacheHitPct'
]);

function assertTurnUsageStatsDelta(
  channel: string,
  prefix: string,
  delta: Record<string, unknown>
): void {
  for (const key of Object.keys(delta)) {
    if (!USAGE_INCREMENT_FIELDS.has(key)) {
      throw new Error(`${channel}: ${prefix}.${key} is not a recognized usage increment field`);
    }
  }
  if ('netCacheSavingsUsd' in delta && delta.netCacheSavingsUsd !== undefined) {
    assertNumber(channel, `${prefix}.netCacheSavingsUsd`, delta.netCacheSavingsUsd, {
      min: -1_000_000,
      max: 1_000_000
    });
  }
  if ('cachedTokens' in delta && delta.cachedTokens !== undefined) {
    assertNumber(channel, `${prefix}.cachedTokens`, delta.cachedTokens, {
      integer: true,
      min: 0,
      max: 1_000_000_000
    });
  }
  if ('reasoningTokens' in delta && delta.reasoningTokens !== undefined) {
    assertNumber(channel, `${prefix}.reasoningTokens`, delta.reasoningTokens, {
      integer: true,
      min: 0,
      max: 1_000_000_000
    });
  }
  if ('lastCacheHitPct' in delta && delta.lastCacheHitPct !== undefined) {
    assertNumber(channel, `${prefix}.lastCacheHitPct`, delta.lastCacheHitPct, {
      min: 0,
      max: 100
    });
  }
}

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
      key === 'workspaceSpendIncrement' ||
      key === 'workspaceUsageIncrement';
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
      const bounds = UI_NUMERIC_BOUNDS[k];
      assertNumber(channel, `patch.ui.${k}`, ui[k], {
        integer: true,
        min: bounds.min,
        max: bounds.max
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
  if ('diffLayout' in ui && ui.diffLayout !== undefined) {
    assertEnum(channel, 'patch.ui.diffLayout', ui.diffLayout, ['unified', 'split']);
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
  if ('filesExpandedWorkspaces' in ui && ui.filesExpandedWorkspaces !== undefined) {
    assertStringArray(channel, 'patch.ui.filesExpandedWorkspaces', ui.filesExpandedWorkspaces, {
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
      if (typeof spend === 'number') {
        assertNumber(channel, `patch.ui.workspaceSpendUsd[${wsId}]`, spend, {
          min: 0,
          max: 1_000_000
        });
      } else {
        assertObject(channel, `patch.ui.workspaceSpendUsd[${wsId}]`, spend);
        const stats = spend as Record<string, unknown>;
        assertNumber(channel, `patch.ui.workspaceSpendUsd[${wsId}].spendUsd`, stats.spendUsd, {
          min: 0,
          max: 1_000_000
        });
      }
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
  if ('workspaceUsageIncrement' in ui && ui.workspaceUsageIncrement !== undefined) {
    assertObject(channel, 'patch.ui.workspaceUsageIncrement', ui.workspaceUsageIncrement);
    const map = ui.workspaceUsageIncrement as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.workspaceUsageIncrement', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, delta] of Object.entries(map)) {
      assertString(channel, 'patch.ui.workspaceUsageIncrement key', wsId);
      assertObject(channel, `patch.ui.workspaceUsageIncrement[${wsId}]`, delta);
      const d = delta as Record<string, unknown>;
      assertNumber(channel, `patch.ui.workspaceUsageIncrement[${wsId}].spendUsd`, d.spendUsd, {
        min: 0,
        max: 1_000_000
      });
      assertTurnUsageStatsDelta(
        channel,
        `patch.ui.workspaceUsageIncrement[${wsId}]`,
        d
      );
    }
  }
  if ('pinnedConversationIds' in ui && ui.pinnedConversationIds !== undefined) {
    assertStringArray(channel, 'patch.ui.pinnedConversationIds', ui.pinnedConversationIds, {
      maxItems: UI_RECORD_MAX_KEYS
    });
  }
  if ('keybindings' in ui && ui.keybindings !== undefined) {
    assertObject(channel, 'patch.ui.keybindings', ui.keybindings);
    const map = ui.keybindings as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.keybindings', map, 32);
    for (const [id, combo] of Object.entries(map)) {
      assertString(channel, 'patch.ui.keybindings key', id, { maxBytes: 64 });
      assertString(channel, `patch.ui.keybindings[${id}]`, combo, { maxBytes: 64 });
    }
  }
  if ('recentEditorFilesByWorkspace' in ui && ui.recentEditorFilesByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.recentEditorFilesByWorkspace', ui.recentEditorFilesByWorkspace);
    const map = ui.recentEditorFilesByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.recentEditorFilesByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, paths] of Object.entries(map)) {
      assertString(channel, 'patch.ui.recentEditorFilesByWorkspace key', wsId);
      assertStringArray(channel, `patch.ui.recentEditorFilesByWorkspace[${wsId}]`, paths, {
        maxItems: RECENT_EDITOR_FILES_MAX_PER_WS,
        maxBytes: 4096
      });
    }
  }
  if ('fileTreeExpandedByWorkspace' in ui && ui.fileTreeExpandedByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.fileTreeExpandedByWorkspace', ui.fileTreeExpandedByWorkspace);
    const map = ui.fileTreeExpandedByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.fileTreeExpandedByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, paths] of Object.entries(map)) {
      assertString(channel, 'patch.ui.fileTreeExpandedByWorkspace key', wsId);
      assertStringArray(channel, `patch.ui.fileTreeExpandedByWorkspace[${wsId}]`, paths, {
        maxItems: FILE_TREE_EXPANDED_MAX_PER_WS,
        maxBytes: 4096
      });
    }
  }
  if ('editorTabsByWorkspace' in ui && ui.editorTabsByWorkspace !== undefined) {
    assertObject(channel, 'patch.ui.editorTabsByWorkspace', ui.editorTabsByWorkspace);
    const map = ui.editorTabsByWorkspace as Record<string, unknown>;
    assertRecordKeyCount(channel, 'patch.ui.editorTabsByWorkspace', map, UI_RECORD_MAX_KEYS);
    for (const [wsId, tabs] of Object.entries(map)) {
      assertString(channel, 'patch.ui.editorTabsByWorkspace key', wsId);
      if (!Array.isArray(tabs)) {
        throw new Error(`${channel}: patch.ui.editorTabsByWorkspace[${wsId}] must be an array`);
      }
      if (tabs.length > EDITOR_TABS_MAX_PER_WS) {
        throw new Error(
          `${channel}: patch.ui.editorTabsByWorkspace[${wsId}] exceeds ${EDITOR_TABS_MAX_PER_WS} tabs`
        );
      }
      for (const entry of tabs) {
        assertObject(channel, `patch.ui.editorTabsByWorkspace[${wsId}] entry`, entry);
        const row = entry as Record<string, unknown>;
        assertString(channel, 'editorTabs entry.filePath', row.filePath, { maxBytes: 4096 });
        if ('active' in row && row.active !== undefined) {
          assertBoolean(channel, 'editorTabs entry.active', row.active);
        }
      }
    }
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
  if ('capture' in ui && ui.capture !== undefined) {
    assertObject(channel, 'patch.ui.capture', ui.capture);
    const capture = ui.capture as Record<string, unknown>;
    for (const key of Object.keys(capture)) {
      if (!(CAPTURE_BOOLEAN_KEYS as readonly string[]).includes(key)) {
        throw new Error(`${channel}: patch.ui.capture.${key} is not a recognized capture field`);
      }
    }
    for (const k of CAPTURE_BOOLEAN_KEYS) {
      if (k in capture && capture[k] !== undefined) {
        assertBoolean(channel, `patch.ui.capture.${k}`, capture[k]);
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
  if ('inlineCompletion' in ui && ui.inlineCompletion !== undefined) {
    assertObject(channel, 'patch.ui.inlineCompletion', ui.inlineCompletion);
    const inlineCompletion = ui.inlineCompletion as Record<string, unknown>;
    const INLINE_COMPLETION_BOOLEAN_KEYS = ['enabled', 'editorEnabled', 'composerEnabled'] as const;
    for (const key of Object.keys(inlineCompletion)) {
      const allowed =
        (INLINE_COMPLETION_BOOLEAN_KEYS as readonly string[]).includes(key) ||
        key === 'providerId' ||
        key === 'modelId' ||
        key === 'debounceMs';
      if (!allowed) {
        throw new Error(
          `${channel}: patch.ui.inlineCompletion.${key} is not a recognized inlineCompletion field`
        );
      }
    }
    for (const k of INLINE_COMPLETION_BOOLEAN_KEYS) {
      if (k in inlineCompletion && inlineCompletion[k] !== undefined) {
        assertBoolean(channel, `patch.ui.inlineCompletion.${k}`, inlineCompletion[k]);
      }
    }
    if ('providerId' in inlineCompletion && inlineCompletion.providerId !== undefined) {
      assertString(channel, 'patch.ui.inlineCompletion.providerId', inlineCompletion.providerId);
    }
    if ('modelId' in inlineCompletion && inlineCompletion.modelId !== undefined) {
      assertString(channel, 'patch.ui.inlineCompletion.modelId', inlineCompletion.modelId);
    }
    if ('debounceMs' in inlineCompletion && inlineCompletion.debounceMs !== undefined) {
      assertNumber(channel, 'patch.ui.inlineCompletion.debounceMs', inlineCompletion.debounceMs, {
        min: 150,
        max: 2000
      });
    }
  }
  if ('vectorMemory' in ui && ui.vectorMemory !== undefined) {
    assertObject(channel, 'patch.ui.vectorMemory', ui.vectorMemory);
    const vectorMemory = ui.vectorMemory as Record<string, unknown>;
    for (const key of Object.keys(vectorMemory)) {
      if (key !== 'embedder' && key !== 'ollamaBaseUrl' && key !== 'ollamaModel') {
        throw new Error(
          `${channel}: patch.ui.vectorMemory.${key} is not a recognized vectorMemory field`
        );
      }
    }
    if ('embedder' in vectorMemory && vectorMemory.embedder !== undefined) {
      assertEnum(channel, 'patch.ui.vectorMemory.embedder', vectorMemory.embedder, [
        'hash',
        'ollama'
      ]);
    }
    if ('ollamaBaseUrl' in vectorMemory && vectorMemory.ollamaBaseUrl !== undefined) {
      assertString(channel, 'patch.ui.vectorMemory.ollamaBaseUrl', vectorMemory.ollamaBaseUrl);
    }
    if ('ollamaModel' in vectorMemory && vectorMemory.ollamaModel !== undefined) {
      assertString(channel, 'patch.ui.vectorMemory.ollamaModel', vectorMemory.ollamaModel);
    }
  }
  if ('editorLsp' in ui && ui.editorLsp !== undefined) {
    assertObject(channel, 'patch.ui.editorLsp', ui.editorLsp);
    const editorLsp = ui.editorLsp as Record<string, unknown>;
    for (const key of Object.keys(editorLsp)) {
      if (key !== 'enabled' && key !== 'command' && key !== 'args' && key !== 'languages') {
        throw new Error(
          `${channel}: patch.ui.editorLsp.${key} is not a recognized editorLsp field`
        );
      }
    }
    if ('enabled' in editorLsp && editorLsp.enabled !== undefined) {
      assertBoolean(channel, 'patch.ui.editorLsp.enabled', editorLsp.enabled);
    }
    if ('command' in editorLsp && editorLsp.command !== undefined) {
      assertString(channel, 'patch.ui.editorLsp.command', editorLsp.command, { nonEmpty: false });
    }
    if ('args' in editorLsp && editorLsp.args !== undefined) {
      assertStringArray(channel, 'patch.ui.editorLsp.args', editorLsp.args);
    }
    if ('languages' in editorLsp && editorLsp.languages !== undefined) {
      assertObject(channel, 'patch.ui.editorLsp.languages', editorLsp.languages);
      const languages = editorLsp.languages as Record<string, unknown>;
      for (const [lang, entry] of Object.entries(languages)) {
        assertObject(channel, `patch.ui.editorLsp.languages.${lang}`, entry);
        const langEntry = entry as Record<string, unknown>;
        if ('command' in langEntry && langEntry.command !== undefined) {
          assertString(channel, `patch.ui.editorLsp.languages.${lang}.command`, langEntry.command, {
            nonEmpty: false
          });
        }
        if ('args' in langEntry && langEntry.args !== undefined) {
          assertStringArray(channel, `patch.ui.editorLsp.languages.${lang}.args`, langEntry.args);
        }
      }
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
      if ('summaryModel' in cm && cm.summaryModel !== undefined) {
        assertObject(channel, 'patch.ui.agentBehavior.contextManagement.summaryModel', cm.summaryModel);
        const summaryModel = cm.summaryModel as Record<string, unknown>;
        for (const key of Object.keys(summaryModel)) {
          if (key !== 'providerId' && key !== 'modelId') {
            throw new Error(
              `${channel}: patch.ui.agentBehavior.contextManagement.summaryModel.${key} is not a recognized field`
            );
          }
        }
        if ('providerId' in summaryModel && summaryModel.providerId !== undefined) {
          assertString(
            channel,
            'patch.ui.agentBehavior.contextManagement.summaryModel.providerId',
            summaryModel.providerId,
            { nonEmpty: false }
          );
        }
        if ('modelId' in summaryModel && summaryModel.modelId !== undefined) {
          assertString(
            channel,
            'patch.ui.agentBehavior.contextManagement.summaryModel.modelId',
            summaryModel.modelId,
            { nonEmpty: false }
          );
        }
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
  if ('ui' in patch && patch.ui !== undefined) {
    assertObject(channel, 'patch.ui', patch.ui);
    assertUiPatch(channel, patch.ui as Record<string, unknown>);
  }
}
