/**
 * `wrapIpcHandler` tests. The contract:
 *   - Calls `ipcMain.handle(channel, …)` exactly once.
 *   - Forwards the original args to the inner handler.
 *   - Re-throws errors so `invoke()` rejects on the renderer side.
 *
 * The electron mock's `ipcMain.__invoke` lets us exercise the wrapped
 * handler synchronously without a real IPC round-trip.
 */

import { describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { wrapIpcHandler } from '@main/ipc/wrapIpcHandler';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

describe('wrapIpcHandler', () => {
  it('registers a handler under the given channel and returns its result', async () => {
    const inner = vi.fn(async (_e: unknown, value: number) => value * 2);
    wrapIpcHandler('test:double', inner);
    const out = await (ipcMain as unknown as MockIpcMain).__invoke('test:double', 21);
    expect(out).toBe(42);
    expect(inner).toHaveBeenCalledOnce();
  });

  it('forwards multiple arguments verbatim', async () => {
    const inner = vi.fn(async (_e: unknown, a: string, b: number, c: { ok: boolean }) =>
      `${a}-${b}-${c.ok}`
    );
    wrapIpcHandler('test:multi', inner);
    const out = await (ipcMain as unknown as MockIpcMain).__invoke(
      'test:multi',
      'hi',
      7,
      { ok: true }
    );
    expect(out).toBe('hi-7-true');
  });

  it('re-throws errors so the renderer Promise rejects', async () => {
    wrapIpcHandler('test:throws', async () => {
      throw new Error('boom');
    });
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke('test:throws')
    ).rejects.toThrow(/boom/);
  });

  it('handles synchronous (non-Promise) handler return values', async () => {
    wrapIpcHandler('test:sync', (_e: unknown, n: number) => n + 1);
    const out = await (ipcMain as unknown as MockIpcMain).__invoke('test:sync', 99);
    expect(out).toBe(100);
  });
});
