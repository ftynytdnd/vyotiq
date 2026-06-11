/**
 * Settings IPC.
 */

import { IPC } from '@shared/constants.js';
import type { AppSettings } from '@shared/types/ipc.js';
import { getSettings, normalizeSettingsPatch, setSettings } from '../settings/settingsStore.js';
import { getPromptCacheRuntimeStatus } from '../settings/promptCachingRuntime.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertSettingsPatch } from './settingsValidate.js';

export function registerSettingsIpc(): void {
  wrapIpcHandler(IPC.SETTINGS_GET, async () => getSettings());
  wrapIpcHandler(IPC.SETTINGS_SET, async (_event, patch: Partial<AppSettings>) => {
    const normalized = normalizeSettingsPatch(patch);
    assertSettingsPatch('settings:set', normalized);
    return setSettings(normalized);
  });
  wrapIpcHandler(IPC.PROMPT_CACHE_STATUS, async () => getPromptCacheRuntimeStatus());
}
