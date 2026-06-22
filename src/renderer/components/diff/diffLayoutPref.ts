/**
 * Persisted unified vs split diff layout preference (`settings.ui.diffLayout`).
 */

import type { AppSettings } from '@shared/types/ipc.js';

export type DiffLayoutMode = 'unified' | 'split';

const LEGACY_STORAGE_KEY = 'vyotiq.diff.layout';

export function resolveDiffLayoutPref(ui?: AppSettings['ui']): DiffLayoutMode {
  if (ui?.diffLayout === 'split' || ui?.diffLayout === 'unified') {
    return ui.diffLayout;
  }
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === 'split' || raw === 'unified') return raw;
  } catch {
    /* ignore quota / private mode */
  }
  return 'unified';
}

/** One-shot migration from pre-settings localStorage; returns null when nothing to migrate. */
export function takeLegacyDiffLayoutPref(ui?: AppSettings['ui']): DiffLayoutMode | null {
  if (ui?.diffLayout === 'split' || ui?.diffLayout === 'unified') return null;
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw !== 'split' && raw !== 'unified') return null;
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return raw;
  } catch {
    return null;
  }
}
