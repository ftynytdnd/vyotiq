/**
 * Settings panel helper — `settings.set` + store merge + error toast.
 */

import { useCallback } from 'react';
import type { AppSettings } from '@shared/types/ipc.js';
import { persistSettingsPatch } from '../lib/persistSettingsPatch.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useToastStore } from '../store/useToastStore.js';

export function useSettingsPatch(errorLabel: string) {
  const settings = useSettingsStore((s) => s.settings);

  const apply = useCallback(
    (patch: Partial<AppSettings>) => {
      void persistSettingsPatch(patch).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save ${errorLabel}: ${msg}`, 'danger');
      });
    },
    [errorLabel]
  );

  return { settings, apply };
}
