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

vi.mock('@main/settings/settingsStore', () => ({
  getSettings: vi.fn(async () => ({})),
  setSettings: (patch: unknown) => setSettingsMock(patch)
}));

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

  it('accepts gatePromptOnPendingByWorkspace per-workspace map', async () => {
    await mockIpc.__invoke(IPC.SETTINGS_SET, {
      ui: { gatePromptOnPendingByWorkspace: { 'ws-1': true, 'ws-2': false } }
    });
    expect(setSettingsMock).toHaveBeenCalledOnce();
  });
});
