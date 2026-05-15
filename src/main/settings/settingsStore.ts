/**
 * Application settings store. Plain JSON, non-secret. Routes all reads/writes
 * through `settings/blob.ts` so the workspace state never silently overwrites
 * settings (and vice versa).
 */

import type { AppSettings } from '@shared/types/ipc.js';
import { DEFAULT_PERMISSIONS } from '@shared/constants.js';
import { readBlob, updateBlob, type SettingsBlob } from './blob.js';

const DEFAULTS: AppSettings = { permissions: DEFAULT_PERMISSIONS };

function publicShape(blob: SettingsBlob): AppSettings {
  // Strip internal-only fields. The workspaces registry and active id
  // are surfaced to the renderer via `vyotiq.workspace.list()`, not
  // through the generic settings IPC, so they have no business
  // appearing in `AppSettings`.
  const {
    workspacePath: _ws,
    workspaces: _wsList,
    activeWorkspaceId: _activeWs,
    ...rest
  } = blob;
  void _ws;
  void _wsList;
  void _activeWs;
  return {
    ...DEFAULTS,
    ...rest,
    permissions: { ...DEFAULT_PERMISSIONS, ...(rest.permissions ?? {}) }
  };
}

export async function getSettings(): Promise<AppSettings> {
  return publicShape(await readBlob());
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = await updateBlob((current) => ({
    ...current,
    ...patch,
    permissions: {
      ...DEFAULT_PERMISSIONS,
      ...(current.permissions ?? {}),
      ...(patch.permissions ?? {})
    },
    // Deep-merge `ui` so a partial patch (e.g. just `sidebarOpen`) doesn't
    // clobber sibling fields written by other features.
    ui: {
      ...(current.ui ?? {}),
      ...(patch.ui ?? {})
    }
  }));
  return publicShape(next);
}
