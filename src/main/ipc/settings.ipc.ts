/**
 * Settings IPC.
 */

import { IPC } from '@shared/constants.js';
import type { AppSettings } from '@shared/types/ipc.js';
import { getSettings, setSettings } from '../settings/settingsStore.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertSettingsPatch } from './settingsValidate.js';

export function registerSettingsIpc(): void {
  wrapIpcHandler(IPC.SETTINGS_GET, async () => getSettings());
  wrapIpcHandler(IPC.SETTINGS_SET, async (_event, patch: Partial<AppSettings>) => {
    assertSettingsPatch('settings:set', patch);
    return setSettings(patch);
  });
}
