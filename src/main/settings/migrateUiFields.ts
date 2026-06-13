/**
 * Legacy `ui` field migration — `sidebarVisible` / `sidebarWidth` and
 * deprecated `sidebarOpen` → `dockExpanded` / `dockWidth`.
 */

import { normalizeDockWidthInUi } from '@shared/dock/dockWidth.js';
import type { AppSettings } from '@shared/types/ipc.js';

type UiRecord = Record<string, unknown>;

/**
 * Map pre–dock-rename keys onto the current shape and drop legacy names so
 * IPC validation and on-disk JSON stay aligned.
 */
export function migrateLegacyDockUi<T extends UiRecord>(ui: T): { ui: T; changed: boolean } {
  let changed = false;
  let next: UiRecord = { ...ui };

  if ('sidebarVisible' in next) {
    if (next.dockExpanded === undefined && typeof next.sidebarVisible === 'boolean') {
      next = { ...next, dockExpanded: next.sidebarVisible };
      changed = true;
    }
    const { sidebarVisible: _sv, ...rest } = next;
    void _sv;
    next = rest;
    changed = true;
  }

  if ('sidebarWidth' in next) {
    if (next.dockWidth === undefined && typeof next.sidebarWidth === 'number') {
      next = { ...next, dockWidth: next.sidebarWidth };
      changed = true;
    }
    const { sidebarWidth: _sw, ...rest } = next;
    void _sw;
    next = rest;
    changed = true;
  }

  if ('sidebarOpen' in next && next.dockExpanded === undefined && typeof next.sidebarOpen === 'boolean') {
    next = { ...next, dockExpanded: next.sidebarOpen };
    changed = true;
  }

  if ('sidebarOpen' in next && next.dockExpanded !== undefined) {
    const { sidebarOpen: _so, ...rest } = next;
    void _so;
    next = rest;
    changed = true;
  }

  return { ui: next as T, changed };
}

/** Strip removed right-dock fields from persisted settings. */
export function stripRemovedUiFields<T extends UiRecord>(ui: T): { ui: T; changed: boolean } {
  let changed = false;
  let next: UiRecord = { ...ui };
  for (const key of ['secondaryZoneMode', 'rightDockWidth'] as const) {
    if (key in next) {
      const { [key]: _removed, ...rest } = next;
      void _removed;
      next = rest;
      changed = true;
    }
  }
  return { ui: next as T, changed };
}

/** Normalize a `settings:set` patch before runtime validation (stale renderer bundles). */
export function normalizeSettingsPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object' || !patch.ui) return patch;
  let { ui, changed } = migrateLegacyDockUi({ ...patch.ui } as UiRecord);
  const stripped = stripRemovedUiFields(ui);
  ui = stripped.ui;
  changed = changed || stripped.changed;
  const dock = normalizeDockWidthInUi(ui);
  ui = dock.ui;
  changed = changed || dock.changed;
  if (!changed) return patch;
  return { ...patch, ui: ui as AppSettings['ui'] };
}
