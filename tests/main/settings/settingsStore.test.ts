/**
 * `settingsStore.ts` migration tests.
 *
 * Locks legacy settings.json cleanup on read/write.
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

describe('publicShape — legacy settings cleanup', () => {
  it('strips legacy top-level permissions on read', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed(
      SETTINGS_FILE,
      { permissions: { allowAuto: true, allowFileWrites: true } }
    );
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got).not.toHaveProperty('permissions');
  });

  it('strips permissionsByWorkspace and gate maps on read', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed(
      SETTINGS_FILE,
      {
        ui: {
          permissionsByWorkspace: { 'ws-A': { allowAuto: true } },
          gatePromptOnPendingByWorkspace: { 'ws-A': true }
        }
      }
    );
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got.ui?.permissionsByWorkspace).toBeUndefined();
    expect(got.ui?.gatePromptOnPendingByWorkspace).toBeUndefined();
  });
});

describe('getSettings — eager on-disk migration', () => {
  it('rewrites legacy lastSettingsTab to a group id on first read', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, { ui: { lastSettingsTab: 'memory' } });

    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got.ui?.lastSettingsTab).toBe('agent-behavior');

    const onDisk = peek(SETTINGS_FILE) as { ui?: { lastSettingsTab?: string } } | null;
    expect(onDisk?.ui?.lastSettingsTab).toBe('agent-behavior');
  });

  it('strips webSearchEndpoint from disk on first read', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, { webSearchEndpoint: 'https://example.com/search' });

    const { getSettings } = await import('@main/settings/settingsStore');
    await getSettings();

    const onDisk = peek(SETTINGS_FILE) as Record<string, unknown> | null;
    expect(onDisk).not.toHaveProperty('webSearchEndpoint');
  });

  it('strips contextSummary and legacy ui fields from disk on first read', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      contextSummary: { enabled: true },
      ui: {
        contextSummaryByWorkspace: { 'ws-1': { enabled: false } },
        tokenBudgetWarningTokens: 128_000,
        gatePromptOnPendingByWorkspace: { 'ws-1': true }
      }
    });

    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got).not.toHaveProperty('contextSummary');
    expect(got.ui).not.toHaveProperty('contextSummaryByWorkspace');
    expect(got.ui).not.toHaveProperty('tokenBudgetWarningTokens');
    expect(got.ui).not.toHaveProperty('gatePromptOnPendingByWorkspace');

    const onDisk = peek(SETTINGS_FILE) as {
      contextSummary?: unknown;
      ui?: Record<string, unknown>;
    } | null;
    expect(onDisk).not.toHaveProperty('contextSummary');
    expect(onDisk?.ui).not.toHaveProperty('contextSummaryByWorkspace');
    expect(onDisk?.ui).not.toHaveProperty('tokenBudgetWarningTokens');
    expect(onDisk?.ui).not.toHaveProperty('gatePromptOnPendingByWorkspace');
  });

  it('strips removed context-management ceiling/fraction fields on first read', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      ui: {
        agentBehavior: {
          contextManagement: {
            enabled: true,
            effectiveWindowFraction: 0.9,
            absoluteCeilingTokens: 200_000
          }
        }
      }
    });

    const { getSettings } = await import('@main/settings/settingsStore');
    await getSettings();

    const onDisk = peek(SETTINGS_FILE) as {
      ui?: { agentBehavior?: { contextManagement?: Record<string, unknown> } };
    } | null;
    const cm = onDisk?.ui?.agentBehavior?.contextManagement;
    expect(cm).toBeDefined();
    expect(cm).not.toHaveProperty('effectiveWindowFraction');
    expect(cm).not.toHaveProperty('absoluteCeilingTokens');
    expect(cm?.enabled).toBe(true);
  });
});

describe('setSettings — legacy keys are stripped on first write', () => {
  it('drops top-level permissions from the persisted blob', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      permissions: { allowFileWrites: true, allowBash: true, allowWebSearch: true }
    });
    const { setSettings } = await import('@main/settings/settingsStore');
    await setSettings({ defaultModel: { providerId: 'p', modelId: 'm' } });

    const onDisk = peek(SETTINGS_FILE) as Record<string, unknown> | null;
    expect(onDisk).not.toHaveProperty('permissions');
  });

  it('drops permissionsByWorkspace from disk on first write', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      ui: {
        permissionsByWorkspace: {
          'ws-A': { allowAuto: true }
        }
      }
    });
    const { setSettings } = await import('@main/settings/settingsStore');
    await setSettings({ defaultModel: { providerId: 'p', modelId: 'm' } });

    const onDisk = peek(SETTINGS_FILE) as { ui?: Record<string, unknown> } | null;
    expect(onDisk?.ui).not.toHaveProperty('permissionsByWorkspace');
  });

  it('preserves sibling ui fields when the patch only touches defaultModel', async () => {
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
    await setSettings({ defaultModel: { providerId: 'p', modelId: 'm' } });

    const onDisk = peek(SETTINGS_FILE) as {
      ui?: { sidebarOpen?: boolean; collapsedWorkspaces?: string[] };
    } | null;
    // Unrelated ui fields are preserved; legacy `sidebarOpen` migrates to `dockExpanded`.
    expect(onDisk?.ui?.dockExpanded).toBe(true);
    expect(onDisk?.ui).not.toHaveProperty('sidebarOpen');
    expect(onDisk?.ui?.collapsedWorkspaces).toEqual(['ws-X']);
  });

  it('clamps legacy dockWidth below 240 on getSettings', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      ui: { dockWidth: 200, dockExpanded: false }
    });
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got.ui?.dockWidth).toBe(240);

    const onDisk = peek(SETTINGS_FILE) as { ui?: { dockWidth?: number } } | null;
    expect(onDisk?.ui?.dockWidth).toBe(240);
  });

  it('migrates sidebarVisible on disk to dockExpanded on getSettings', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const seed = (safeStore as unknown as { __seed: (f: string, v: unknown) => void }).__seed;
    const peek = (safeStore as unknown as { __peek: (f: string) => unknown }).__peek;
    seed(SETTINGS_FILE, {
      ui: { sidebarVisible: true, sidebarWidth: 220 }
    });
    const { getSettings } = await import('@main/settings/settingsStore');
    const got = await getSettings();
    expect(got.ui?.dockExpanded).toBe(true);
    expect(got.ui?.dockWidth).toBe(240);
    expect(got.ui).not.toHaveProperty('sidebarVisible');
    expect(got.ui).not.toHaveProperty('sidebarWidth');

    const onDisk = peek(SETTINGS_FILE) as { ui?: Record<string, unknown> } | null;
    expect(onDisk?.ui?.dockExpanded).toBe(true);
    expect(onDisk?.ui?.dockWidth).toBe(240);
    expect(onDisk?.ui).not.toHaveProperty('sidebarVisible');
  });
});
