/**
 * Settings IPC.
 */

import { IPC } from '@shared/constants.js';
import type { AppSettings, SettingsPatch } from '@shared/types/ipc.js';
import { getSettings, normalizeSettingsPatch, setSettings } from '../settings/settingsStore.js';
import { reindexAllWorkspacesIfVectorMemoryChanged } from '../settings/vectorReindexOnSettings.js';
import { getPromptCacheRuntimeStatus } from '../settings/promptCachingRuntime.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertSettingsPatch } from './settingsValidate.js';

export function registerSettingsIpc(): void {
  wrapIpcHandler(IPC.SETTINGS_GET, async () => getSettings());
  wrapIpcHandler(IPC.SETTINGS_SET, async (_event, patch: SettingsPatch) => {
    const before = await getSettings();
    const normalized = normalizeSettingsPatch(patch);
    assertSettingsPatch('settings:set', normalized);
    const updated = await setSettings(normalized);
    await reindexAllWorkspacesIfVectorMemoryChanged(before, updated);
    return updated;
  });
  wrapIpcHandler(IPC.PROMPT_CACHE_STATUS, async () => getPromptCacheRuntimeStatus());
}
