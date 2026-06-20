/**
 * Regression tests for `settings:set` payload validation.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const setSettingsMock = vi.fn(async (patch: unknown) => patch);

// Stub the on-disk settings store but keep the REAL `normalizeSettingsPatch`
// (a pure helper re-exported from `migrateUiFields`) so the validation path
// exercises the same legacy-key migration the production handler runs before
// `assertSettingsPatch`. Importing it from the pure module avoids pulling in
// the store's disk/electron side effects.
vi.mock('@main/settings/settingsStore', async () => {
  const { normalizeSettingsPatch } = await import('@main/settings/migrateUiFields');
  return {
    getSettings: vi.fn(async () => ({})),
    setSettings: (patch: unknown) => setSettingsMock(patch),
    normalizeSettingsPatch
  };
});

const { registerSettingsIpc } = await import('@main/ipc/settings.ipc');

describe('registerSettingsIpc — SETTINGS_SET payload validation', () => {
  beforeEach(() => {
    setSettingsMock.mockClear();
    mockIpc.__handlers.clear();
    registerSettingsIpc();
  });

  it('accepts a plain object patch', async () => {
    await mockIpc.__invoke(IPC.SETTINGS_SET, { ui: { dockExpanded: true } });
    expect(setSettingsMock).toHaveBeenCalledOnce();
  });

  it('rejects null / arrays / primitives', async () => {
    await expect(mockIpc.__invoke(IPC.SETTINGS_SET, null)).rejects.toThrow(
      /settings:set: patch must be a non-null object/
    );
    await expect(mockIpc.__invoke(IPC.SETTINGS_SET, [])).rejects.toThrow(
      /settings:set: patch must be a non-null object/
    );
    await expect(mockIpc.__invoke(IPC.SETTINGS_SET, 'bad')).rejects.toThrow(
      /settings:set: patch must be a non-null object/
    );
  });

  it('rejects unknown top-level patch keys', async () => {
    await expect(
      mockIpc.__invoke(IPC.SETTINGS_SET, { evilPayload: true })
    ).rejects.toThrow(/not a recognized settings field/);
    expect(setSettingsMock).not.toHaveBeenCalled();
  });

  it('accepts dockWidth within 240–320', async () => {
    await mockIpc.__invoke(IPC.SETTINGS_SET, { ui: { dockWidth: 300 } });
    expect(setSettingsMock).toHaveBeenCalledOnce();
  });

  it('clamps legacy dockWidth below 240 before validation', async () => {
    await mockIpc.__invoke(IPC.SETTINGS_SET, { ui: { dockWidth: 200, theme: 'dark' } });
    expect(setSettingsMock).toHaveBeenCalledWith({ ui: { dockWidth: 240, theme: 'dark' } });
  });

  it('clamps dockWidth above 320 before validation', async () => {
    await mockIpc.__invoke(IPC.SETTINGS_SET, { ui: { dockWidth: 400 } });
    expect(setSettingsMock).toHaveBeenCalledWith({ ui: { dockWidth: 320 } });
  });

  it('rejects removed legacy ui fields', async () => {
    await expect(
      mockIpc.__invoke(IPC.SETTINGS_SET, {
        ui: { gatePromptOnPendingByWorkspace: { 'ws-1': true } }
      })
    ).rejects.toThrow(/not a recognized ui field/);
    expect(setSettingsMock).not.toHaveBeenCalled();
  });

  it('accepts fileTreeExpandedByWorkspace', async () => {
    await mockIpc.__invoke(IPC.SETTINGS_SET, {
      ui: { fileTreeExpandedByWorkspace: { 'ws-1': ['src', 'docs'] } }
    });
    expect(setSettingsMock).toHaveBeenCalledWith({
      ui: { fileTreeExpandedByWorkspace: { 'ws-1': ['src', 'docs'] } }
    });
  });

  it('accepts editorTabsByWorkspace', async () => {
    await mockIpc.__invoke(IPC.SETTINGS_SET, {
      ui: {
        editorTabsByWorkspace: {
          'ws-1': [{ filePath: 'src/main.ts', active: true }]
        }
      }
    });
    expect(setSettingsMock).toHaveBeenCalledOnce();
  });

  it('rejects editorTabsByWorkspace exceeding tab cap', async () => {
    const tabs = Array.from({ length: 21 }, (_, i) => ({ filePath: `f${i}.ts` }));
    await expect(
      mockIpc.__invoke(IPC.SETTINGS_SET, {
        ui: { editorTabsByWorkspace: { 'ws-1': tabs } }
      })
    ).rejects.toThrow(/exceeds 20 tabs/);
    expect(setSettingsMock).not.toHaveBeenCalled();
  });
});
