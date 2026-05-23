/**
 * `registerAppIpc` tests — verifies that the App info IPC returns the
 * expected shape (version + on-disk paths) and that the path-reveal
 * channel only accepts the three whitelisted enum targets.
 *
 * The electron mock in `tests/setup/electronMock.ts` stubs
 * `app.getPath('userData')` and `shell.showItemInFolder`; we lean on
 * the same `ipcMain.__invoke` helper used by `wrapIpcHandler.test.ts`
 * to drive the handlers synchronously without a real IPC round-trip.
 */

import { describe, expect, it, vi } from 'vitest';
import { ipcMain, shell } from 'electron';
import { join } from 'node:path';
import type { AppInfo, AppRevealTarget } from '@shared/types/ipc';
import { IPC, SETTINGS_FILE } from '@shared/constants';
import { registerAppIpc } from '@main/ipc/app.ipc';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

describe('registerAppIpc — APP_INFO_GET', () => {
  it('returns the app version, runtime versions, and userData/settings/log paths', async () => {
    registerAppIpc();
    const info = (await mockIpc.__invoke(IPC.APP_INFO_GET)) as AppInfo;

    // Version comes from the electron mock (`'0.0.0-test'`).
    expect(info.version).toBe('0.0.0-test');
    // Runtime version strings are whatever `process.versions` reports in
    // the node host running vitest — the contract is "non-empty string".
    expect(typeof info.electron).toBe('string');
    expect(typeof info.node).toBe('string');

    // The userData dir is set by `electronMock.ts` to a mkdtemp scratch
    // path. We assert structurally rather than against a fixed string
    // because the mock creates a fresh dir per test run.
    expect(info.userDataDir.length).toBeGreaterThan(0);
    expect(info.settingsFile).toBe(join(info.userDataDir, SETTINGS_FILE));
    expect(info.logDir).toBe(join(info.userDataDir, 'vyotiq', 'logs'));
  });
});

describe('registerAppIpc — APP_REVEAL_PATH', () => {
  it('maps each enum target to the right path and calls showItemInFolder once', async () => {
    registerAppIpc();
    const showSpy = vi.mocked(shell.showItemInFolder);
    showSpy.mockClear();

    // Pull the path mapping straight from the same handler so the test
    // can't drift away from production. (The renderer always uses these
    // three targets via the `AppRevealTarget` union.)
    const info = (await mockIpc.__invoke(IPC.APP_INFO_GET)) as AppInfo;

    await mockIpc.__invoke(IPC.APP_REVEAL_PATH, 'userData' as AppRevealTarget);
    await mockIpc.__invoke(IPC.APP_REVEAL_PATH, 'settings' as AppRevealTarget);
    await mockIpc.__invoke(IPC.APP_REVEAL_PATH, 'log' as AppRevealTarget);

    expect(showSpy).toHaveBeenCalledTimes(3);
    expect(showSpy).toHaveBeenNthCalledWith(1, info.userDataDir);
    expect(showSpy).toHaveBeenNthCalledWith(2, info.settingsFile);
    expect(showSpy).toHaveBeenNthCalledWith(3, info.logDir);
  });

  it('rejects an unknown target without calling shell', async () => {
    registerAppIpc();
    const showSpy = vi.mocked(shell.showItemInFolder);
    showSpy.mockClear();

    await expect(
      // Casting through `unknown` to bypass the union — a malicious
      // renderer (or a typo in a future call site) is the threat this
      // guard exists for.
      mockIpc.__invoke(IPC.APP_REVEAL_PATH, 'arbitrary-evil-path' as unknown as AppRevealTarget)
    ).rejects.toThrow(/target must be one of: userData, settings, log/);

    expect(showSpy).not.toHaveBeenCalled();
  });
});
