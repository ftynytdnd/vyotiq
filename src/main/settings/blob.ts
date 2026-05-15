/**
 * Shared settings blob — single in-process cache + serialized writer for
 * `settings.json`. Both `settingsStore.ts` (app settings) and
 * `workspaceState.ts` (active workspace path) now go through here, so neither
 * one can silently overwrite the other's fields.
 *
 * The blob shape is intentionally a superset (settings + workspace +
 * future top-level fields). Consumers only see what they care about.
 */

import type { AppSettings, WorkspaceEntry } from '@shared/types/ipc.js';
import { SETTINGS_FILE } from '@shared/constants.js';
import { readPlainJson, writePlainJson } from '../secrets/safeStore.js';
import { logger } from '../logging/logger.js';

const log = logger.child('settings/blob');

export interface SettingsBlob extends AppSettings {
  /**
   * Legacy single-workspace folder. Pre-multi-workspace builds wrote
   * only this field. The `workspaceState` migration synthesises a
   * `WorkspaceEntry` from it on first boot and may clear it
   * afterwards; the field is left optional so the on-disk shape stays
   * forward-compatible without rewriting historical settings files.
   */
  workspacePath?: string;
  /**
   * Multi-workspace registry. Authoritative once present. Absence
   * (legacy settings files) triggers the migration in
   * `workspaceState.loadOnce` which seeds this from `workspacePath`.
   */
  workspaces?: WorkspaceEntry[];
  /** Currently-active workspace id (must match an entry in `workspaces`). */
  activeWorkspaceId?: string;
}

let cache: SettingsBlob | null = null;
let loadOnce: Promise<SettingsBlob> | null = null;
/** Single-writer queue. */
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<SettingsBlob> {
  if (cache) return cache;
  if (loadOnce) return loadOnce;
  loadOnce = (async () => {
    try {
      const blob = (await readPlainJson<SettingsBlob>(SETTINGS_FILE)) ?? {};
      cache = blob;
      return blob;
    } catch (err) {
      log.error('failed to read settings.json; starting from empty', { err });
      cache = {};
      return cache;
    }
  })();
  return loadOnce;
}

export async function readBlob(): Promise<SettingsBlob> {
  return { ...(await load()) };
}

/**
 * Atomically merges `patch` into the cached blob and persists it. Subsequent
 * writes are serialized so a slow disk doesn't reorder updates.
 *
 * Cache semantics: we update `cache` eagerly so callers reading immediately
 * after this function resolves see the new value. If the disk write later
 * fails AND no subsequent successful write has overwritten our entry, we
 * roll the cache back to the pre-mutation snapshot so a follow-up read
 * doesn't return state that never made it to disk.
 */
export async function updateBlob(
  mutator: (current: SettingsBlob) => SettingsBlob
): Promise<SettingsBlob> {
  const current = await load();
  const previous = { ...current };
  const next = mutator({ ...current });
  cache = next;
  const flush = writeChain.then(async () => {
    try {
      await writePlainJson(SETTINGS_FILE, next);
    } catch (err) {
      log.error('failed to persist settings.json; rolling back in-memory cache', { err });
      // Only roll back if our entry is still the head of the cache. A
      // later-queued successful write would have already advanced it past
      // `next`, in which case the rollback is moot.
      if (cache === next) cache = previous;
    }
  });
  writeChain = flush;
  await flush;
  return { ...(cache ?? next) };
}
