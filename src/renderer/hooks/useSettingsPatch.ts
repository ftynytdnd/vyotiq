/**
 * Settings panel helper — `settings.set` + store refresh + error toast.
 */

import { useCallback } from 'react';
import type { AppSettings } from '@shared/types/ipc.js';
import { vyotiq } from '../lib/ipc.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useToastStore } from '../store/useToastStore.js';

export function useSettingsPatch(errorLabel: string) {
  const settings = useSettingsStore((s) => s.settings);
  const refresh = useSettingsStore((s) => s.refresh);

  const apply = useCallback(
    (patch: Partial<AppSettings>) => {
      void vyotiq.settings
        .set(patch)
        .then(() => refresh())
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          useToastStore.getState().show(`Could not save ${errorLabel}: ${msg}`, 'danger');
        });
    },
    [errorLabel, refresh]
  );

  return { settings, apply };
}
