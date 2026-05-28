/**
 * Application settings store. Plain JSON, non-secret. Routes all reads/writes
 * through `settings/blob.ts` so the workspace state never silently overwrites
 * settings (and vice versa).
 *
 * Permissions migration (May 2026): the legacy three-flag shape
 * (`allowFileWrites` / `allowBash` / `allowWebSearch`) collapses to a single
 * `allowAuto` boolean on read via `derivePermissions` / `derivePartial`.
 * The first subsequent `setSettings` write naturally strips the deprecated
 * keys so settings.json converges to the new shape over the user's normal
 * usage — no special migration step required.
 */

import type { AppSettings } from '@shared/types/ipc.js';
import { DEFAULT_PERMISSIONS } from '@shared/constants.js';
import { readBlob, updateBlob, type SettingsBlob } from './blob.js';

const DEFAULTS: AppSettings = { permissions: DEFAULT_PERMISSIONS };

/**
 * Legacy permissions shape carried by pre-2026 settings.json files. The
 * fields are optional individually because partial workspace-override
 * entries (e.g. `{ allowBash: false }`) are valid too.
 */
interface LegacyPermissions {
  allowFileWrites?: boolean;
  allowBash?: boolean;
  allowWebSearch?: boolean;
}

/**
 * Collapse the global permissions block (legacy three-flag or new
 * single-flag) into the new `{ allowAuto }` shape. The legacy path
 * sets `allowAuto: true` only when BOTH writes and bash were on —
 * matching the pre-migration "fully enabled" default state. A user
 * who had one of those toggled OFF lands on the safer
 * `allowAuto: false` (every gated action prompts), consistent with
 * the new install default.
 */
function derivePermissions(
  raw: (LegacyPermissions & Partial<{ allowAuto: boolean }>) | undefined
): { allowAuto: boolean } {
  if (raw === undefined) return { ...DEFAULT_PERMISSIONS };
  if (typeof raw.allowAuto === 'boolean') return { allowAuto: raw.allowAuto };
  // Legacy three-flag → single-flag derivation. We deliberately exclude
  // `allowWebSearch` from the AND because it defaulted off in the
  // legacy shape; gating `allowAuto: true` on it would flip every
  // existing user back to "always prompt" on first upgrade.
  const fileWrites = raw.allowFileWrites === true;
  const bash = raw.allowBash === true;
  return { allowAuto: fileWrites && bash };
}

/**
 * Same migration applied to per-workspace override entries. Returns
 * `undefined` for an empty input so absent / `{}` entries stay absent —
 * the per-workspace surface treats absence as "inherit from global"
 * and we don't want to manufacture a synthetic `{ allowAuto: false }`
 * for entries that had no opinion.
 */
/**
 * Effective `allowAuto` for a workspace — global settings merged with
 * per-workspace override. Used by orchestrator-adjacent IPC that must
 * not trust renderer-supplied permission flags.
 */
export function resolvePermissionsForWorkspace(
  settings: AppSettings,
  workspaceId: string | undefined
): { allowAuto: boolean } {
  const global = settings.permissions ?? DEFAULT_PERMISSIONS;
  if (!workspaceId) return global;
  const override = settings.ui?.permissionsByWorkspace?.[workspaceId];
  if (typeof override?.allowAuto === 'boolean') {
    return { allowAuto: override.allowAuto };
  }
  return global;
}

function derivePartial(
  raw: (LegacyPermissions & Partial<{ allowAuto: boolean }>) | undefined
): Partial<{ allowAuto: boolean }> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw.allowAuto === 'boolean') return { allowAuto: raw.allowAuto };
  // Legacy entry: same AND-rule as the global path. If neither
  // `allowFileWrites` nor `allowBash` was set in the entry, the
  // override was vacuous — drop it.
  if (raw.allowFileWrites === undefined && raw.allowBash === undefined) {
    return undefined;
  }
  const fileWrites = raw.allowFileWrites === true;
  const bash = raw.allowBash === true;
  return { allowAuto: fileWrites && bash };
}

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

  // Derive the new-shape `permissions` block from whichever shape the
  // on-disk blob carries. The raw read may still have the legacy
  // three booleans; `derivePermissions` collapses them.
  const permissions = derivePermissions(
    rest.permissions as
    | (LegacyPermissions & Partial<{ allowAuto: boolean }>)
    | undefined
  );

  // Walk the per-workspace override map through the same migration.
  // Dropped entries (vacuous legacy `{}` / `undefined`) disappear from
  // the public shape entirely.
  let permissionsByWorkspace: Record<string, { allowAuto?: boolean }> | undefined;
  const rawMap = rest.ui?.permissionsByWorkspace as
    | Record<string, LegacyPermissions & Partial<{ allowAuto: boolean }>>
    | undefined;
  if (rawMap !== undefined) {
    permissionsByWorkspace = {};
    for (const [wsId, entry] of Object.entries(rawMap)) {
      const derived = derivePartial(entry);
      if (derived !== undefined && Object.keys(derived).length > 0) {
        permissionsByWorkspace[wsId] = derived;
      }
    }
  }

  const ui = rest.ui
    ? {
      ...rest.ui,
      ...(permissionsByWorkspace !== undefined
        ? { permissionsByWorkspace }
        : {})
    }
    : rest.ui;

  return {
    ...DEFAULTS,
    ...rest,
    permissions,
    ...(ui !== undefined ? { ui } : {})
  };
}

export async function getSettings(): Promise<AppSettings> {
  return publicShape(await readBlob());
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = await updateBlob((current) => {
    // Migrate the cached blob's permissions BEFORE merging the patch
    // so legacy keys (`allowFileWrites` etc.) don't leak into the
    // post-write shape. The patch is already new-shape per the
    // updated `AppSettings.permissions` type.
    const migratedPermissions = derivePermissions(
      current.permissions as
      | (LegacyPermissions & Partial<{ allowAuto: boolean }>)
      | undefined
    );

    // Same per-workspace override migration as `publicShape`, but
    // applied to the BLOB so the writeback drops legacy keys. Vacuous
    // entries are removed; sibling maps under `ui` are preserved
    // verbatim.
    let migratedPermsByWs: Record<string, { allowAuto?: boolean }> | undefined;
    const rawMap = current.ui?.permissionsByWorkspace as
      | Record<string, LegacyPermissions & Partial<{ allowAuto: boolean }>>
      | undefined;
    if (rawMap !== undefined) {
      migratedPermsByWs = {};
      for (const [wsId, entry] of Object.entries(rawMap)) {
        const derived = derivePartial(entry);
        if (derived !== undefined && Object.keys(derived).length > 0) {
          migratedPermsByWs[wsId] = derived;
        }
      }
    }

    const currentUi = {
      ...(current.ui ?? {}),
      ...(migratedPermsByWs !== undefined
        ? { permissionsByWorkspace: migratedPermsByWs }
        : {})
    };

    return {
      ...current,
      ...patch,
      permissions: {
        ...DEFAULT_PERMISSIONS,
        ...migratedPermissions,
        ...(patch.permissions ?? {})
      },
      // Deep-merge `ui` so a partial patch (e.g. just `sidebarOpen`)
      // doesn't clobber sibling fields written by other features.
      ui: {
        ...currentUi,
        ...(patch.ui ?? {})
      }
    };
  });
  return publicShape(next);
}
