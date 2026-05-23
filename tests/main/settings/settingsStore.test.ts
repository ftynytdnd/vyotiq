/**
 * `settingsStore.ts` permissions migration tests.
 *
 * Locks the legacy three-flag → single-`allowAuto` migration:
 *   - `publicShape` reads pre-2026 settings.json blobs and derives
 *     `allowAuto` for both the global `permissions` and every
 *     `permissionsByWorkspace[wsId]` entry.
 *   - The first subsequent `setSettings` write strips the deprecated
 *     keys so the on-disk shape converges to the new model over normal
 *     usage — no special migration step required.
 *
 * `blob` is mocked through `safeStore` (the same fixture pattern
 * `blob.test.ts` uses) so each test fully controls the on-disk
 * starting state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/secrets/safeStore', async () => {
  let store: Record<string, unknown> = {};
  return {
    readPlainJson: vi.fn(async (file: string) => store[file] ?? null),
    writePlainJson: vi.fn(async (file: string, data: unknown) => {
      store[file] = data;
    }),
    writeEncryptedJson: vi.fn(),
    readEncryptedJson: vi.fn(async () => null),
    __seed: (file: string, value: unknown) => {
      store[file] = value;
    },
    __peek: (file: string) => store[file],
    __reset: () => {
      store = {};
    }
  };
});

import * as safeStore from '@main/secrets/safeStore';
import { SETTINGS_FILE } from '@shared/constants';

beforeEach(() => {
  // Reset the module graph so `blob.ts`'s in-memory cache starts clean
  // each test — the cache is module-scoped, not dependency-injected, so
  // a stale entry from a sibling test would otherwise mask the read
  // path under test.
  vi.resetModules();
  (safeStore as unknown as { __reset: () => void }).__reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('publicShape — legacy three-flag → allowAuto migration', () => {
  it('derives allowAuto: true when both allowFileWrites and allowBash were on', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed(
      SETTINGS_FILE,
      {
        permissions: {
          allowFileWrites: true,
          allowBash: true,
          allowWebSearch: false
        }
      }
    );
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got.permissions).toEqual({ allowAuto: true });
  });

  it('derives allowAuto: false when either writes or bash was off', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed(
      SETTINGS_FILE,
      {
        permissions: {
          allowFileWrites: true,
          allowBash: false,
          allowWebSearch: true
        }
      }
    );
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    // `allowWebSearch: true` does NOT lift `allowAuto` — the migration
    // intentionally requires both writes AND bash. A user with only
    // web search on lands on the safer always-prompt default.
    expect(got.permissions).toEqual({ allowAuto: false });
  });

  it('passes through new-shape allowAuto verbatim', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed(
      SETTINGS_FILE,
      { permissions: { allowAuto: true } }
    );
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got.permissions).toEqual({ allowAuto: true });
  });

  it('falls back to DEFAULT_PERMISSIONS (allowAuto: false) when permissions is missing', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed(
      SETTINGS_FILE,
      {}
    );
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got.permissions).toEqual({ allowAuto: false });
  });

  it('migrates per-workspace override entries the same way', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed(
      SETTINGS_FILE,
      {
        ui: {
          permissionsByWorkspace: {
            'ws-trusted': { allowFileWrites: true, allowBash: true },
            'ws-cautious': { allowBash: false },
            'ws-vacuous': {},
            'ws-already-migrated': { allowAuto: true }
          }
        }
      }
    );
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    const map = got.ui?.permissionsByWorkspace ?? {};
    // Trusted workspace: writes + bash on → allowAuto: true.
    expect(map['ws-trusted']).toEqual({ allowAuto: true });
    // Cautious workspace: bash off (no writes either) → allowAuto: false.
    expect(map['ws-cautious']).toEqual({ allowAuto: false });
    // Vacuous workspace: empty entry is dropped entirely so absence
    // means "inherit from global" rather than synthesizing a fake
    // `{ allowAuto: false }` override.
    expect('ws-vacuous' in map).toBe(false);
    // Already-migrated workspace: passes through.
    expect(map['ws-already-migrated']).toEqual({ allowAuto: true });
  });
});

describe('setSettings — legacy keys are stripped on first write', () => {
  it('drops allowFileWrites/allowBash/allowWebSearch from the persisted blob', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      permissions: {
        allowFileWrites: true,
        allowBash: true,
        allowWebSearch: false
      }
    });
    const { setSettings } = await import('@main/settings/settingsStore');
    // Touch an unrelated field so the patch fires WITHOUT changing
    // permissions; the migration must still strip the legacy keys.
    await setSettings({ defaultModel: { providerId: 'p', modelId: 'm' } });

    const onDisk = peek(SETTINGS_FILE) as {
      permissions?: Record<string, unknown>;
    } | null;
    expect(onDisk?.permissions).toBeDefined();
    // Legacy keys gone …
    expect(onDisk?.permissions).not.toHaveProperty('allowFileWrites');
    expect(onDisk?.permissions).not.toHaveProperty('allowBash');
    expect(onDisk?.permissions).not.toHaveProperty('allowWebSearch');
    // … new key present and correctly derived.
    expect(onDisk?.permissions?.allowAuto).toBe(true);
  });

  it('drops legacy keys from per-workspace entries on first write', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      ui: {
        permissionsByWorkspace: {
          'ws-A': { allowFileWrites: true, allowBash: true },
          'ws-B': { allowBash: false }
        }
      }
    });
    const { setSettings } = await import('@main/settings/settingsStore');
    await setSettings({ defaultModel: { providerId: 'p', modelId: 'm' } });

    const onDisk = peek(SETTINGS_FILE) as {
      ui?: {
        permissionsByWorkspace?: Record<string, Record<string, unknown>>;
      };
    } | null;
    const map = onDisk?.ui?.permissionsByWorkspace ?? {};
    expect(map['ws-A']).toEqual({ allowAuto: true });
    expect(map['ws-B']).toEqual({ allowAuto: false });
    // Defense-in-depth: the legacy keys must be GONE on disk, not
    // merely shadowed by the new key.
    for (const entry of Object.values(map)) {
      expect(entry).not.toHaveProperty('allowFileWrites');
      expect(entry).not.toHaveProperty('allowBash');
      expect(entry).not.toHaveProperty('allowWebSearch');
    }
  });

  it('preserves sibling ui fields when the patch only touches permissions', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      ui: {
        sidebarOpen: true,
        collapsedWorkspaces: ['ws-X']
      }
    });
    const { setSettings } = await import('@main/settings/settingsStore');
    await setSettings({ permissions: { allowAuto: true } });

    const onDisk = peek(SETTINGS_FILE) as {
      ui?: { sidebarOpen?: boolean; collapsedWorkspaces?: string[] };
      permissions?: { allowAuto?: boolean };
    } | null;
    expect(onDisk?.permissions).toEqual({ allowAuto: true });
    // Unrelated ui fields are preserved verbatim — the migration's
    // ui-merge path doesn't clobber siblings.
    expect(onDisk?.ui?.sidebarOpen).toBe(true);
    expect(onDisk?.ui?.collapsedWorkspaces).toEqual(['ws-X']);
  });
});
