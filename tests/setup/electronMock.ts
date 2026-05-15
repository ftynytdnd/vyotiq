/**
 * Vitest setup for the `main` project. Stubs the `electron` module so
 * imports of `app`, `ipcMain`, `BrowserWindow`, `dialog`, `shell` and
 * `contextBridge` resolve in a node environment with no Electron
 * runtime present.
 *
 * Each stub is intentionally minimal — tests that need a richer
 * surface override it via `vi.mocked(...)` or by re-mocking inside the
 * test file. Keeping the global stub small avoids hidden behavior
 * changes when a test forgets to override.
 */

import { vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Per-process temp dir is good enough for a non-isolated suite; tests
// that need their own scratch space should create their own under
// here via `mkdtemp` to stay parallel-safe.
const userDataDir = mkdtempSync(join(tmpdir(), 'vyotiq-test-userdata-'));

vi.mock('electron', () => {
  const ipcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    app: {
      getPath: (name: string) => {
        if (name === 'userData') return userDataDir;
        if (name === 'temp') return tmpdir();
        return userDataDir;
      },
      getName: () => 'vyotiq-test',
      getVersion: () => '0.0.0-test',
      on: vi.fn(),
      once: vi.fn(),
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
      exit: vi.fn(),
      isReady: () => true
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcMainHandlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        ipcMainHandlers.delete(channel);
      }),
      on: vi.fn(),
      off: vi.fn(),
      // Test helper: invoke a registered handler manually.
      __invoke: (channel: string, ...args: unknown[]) => {
        const h = ipcMainHandlers.get(channel);
        if (!h) throw new Error(`No handler registered for ${channel}`);
        return h({} as never, ...args);
      },
      __handlers: ipcMainHandlers
    },
    BrowserWindow: class MockBrowserWindow {
      static getAllWindows() {
        return [];
      }
      static fromWebContents() {
        return null;
      }
    },
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined }))
    },
    shell: {
      openPath: vi.fn(async () => ''),
      showItemInFolder: vi.fn(),
      openExternal: vi.fn(async () => undefined)
    },
    contextBridge: {
      exposeInMainWorld: vi.fn()
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8')
    }
  };
});
