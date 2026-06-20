/**
 * Fire-and-forget settings persistence that keeps `useSettingsStore` in sync
 * with the post-write shape returned by main — without a follow-up `get`.
 */

import type { AppSettings } from '@shared/types/ipc.js';
import { vyotiq } from './ipc.js';
import { useSettingsStore } from '../store/useSettingsStore.js';

export async function persistSettingsPatch(patch: Partial<AppSettings>): Promise<AppSettings> {
  const updated = await vyotiq.settings.set(patch);
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, ...updated }
  }));
  return updated;
}
