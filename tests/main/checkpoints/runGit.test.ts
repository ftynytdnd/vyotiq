/**
 * runGit — timeout and stdout cap.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

describe('runGit', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns timedOut when git does not exit before the deadline', async () => {
    vi.useFakeTimers();
    const { spawn } = await import('node:child_process');
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn()
    });
    vi.mocked(spawn).mockReturnValue(child as never);

    const { runGit } = await import('../../../src/main/checkpoints/runGit.js');
    const pending = runGit('/tmp/ws', ['status'], { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(60);
    const res = await pending;
    expect(res.timedOut).toBe(true);
    expect(res.stderr).toMatch(/timed out/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it('caps stdout bytes when maxStdoutBytes is set', async () => {
    const { spawn } = await import('node:child_process');
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn()
    });
    vi.mocked(spawn).mockReturnValue(child as never);

    const { runGit } = await import('../../../src/main/checkpoints/runGit.js');
    const pending = runGit('/tmp/ws', ['diff', 'HEAD'], { maxStdoutBytes: 4, timeoutMs: 5_000 });
    child.stdout.emit('data', Buffer.from('abcdef'));
    child.emit('close', 0);
    const res = await pending;
    expect(res.stdout).toBe('abcd');
  });
});
