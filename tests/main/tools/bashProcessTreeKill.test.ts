/**
 * Phase 0.13 — bash child teardown uses process-tree kill helpers.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const spawnMock = vi.fn(() => ({ unref: vi.fn() }));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}));

import { killBashProcessTree } from '@main/tools/bash.tool';

beforeEach(() => {
  spawnMock.mockClear();
});

describe('killBashProcessTree', () => {
  it('uses taskkill /T on Windows', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    killBashProcessTree(4242, 'SIGKILL');
    expect(spawnMock).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '4242', '/T', '/F'],
      expect.objectContaining({ windowsHide: true })
    );
    Object.defineProperty(process, 'platform', { value: platform });
  });

  it('uses negative pid group kill on Unix', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    killBashProcessTree(999, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(-999, 'SIGTERM');
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: platform });
  });
});
