/**
 * Persisted unified vs split diff layout preference.
 */

export type DiffLayoutMode = 'unified' | 'split';

const STORAGE_KEY = 'vyotiq.diff.layout';

export function readDiffLayoutPref(): DiffLayoutMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

export function writeDiffLayoutPref(mode: DiffLayoutMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}
