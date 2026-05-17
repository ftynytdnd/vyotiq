/**
 * Atomic-write helper tests. Pins the two behaviours the per-site
 * copies lacked: bounded retry on Windows-style rename errors and
 * `.tmp` cleanup on terminal failure.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJson } from '@main/checkpoints/atomicWrite';

describe('atomicWriteJson', () => {
  let workDir = '';

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'vyotiq-atomic-'));
  });

  afterEach(async () => {
    try { await rm(workDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.restoreAllMocks();
  });

  it('writes the JSON payload atomically and cleans up its temp file', async () => {
    const target = join(workDir, 'subdir', 'index.json');
    await atomicWriteJson(target, { hello: 'world' });
    const body = await fs.readFile(target, 'utf8');
    expect(JSON.parse(body)).toEqual({ hello: 'world' });
    // No leftover temp.
    const dirEntries = await fs.readdir(join(workDir, 'subdir'));
    expect(dirEntries).toEqual(['index.json']);
  });

  it('retries a transient EPERM rename and ultimately succeeds', async () => {
    const target = join(workDir, 'index.json');
    let failures = 0;
    const originalRename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async (a, b) => {
      if (failures < 2) {
        failures += 1;
        const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return originalRename(a as string, b as string);
    });
    await atomicWriteJson(target, { ok: true });
    expect(spy).toHaveBeenCalledTimes(3); // 2 failed + 1 success
    const body = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(body).toEqual({ ok: true });
  });

  it('rethrows and unlinks the .tmp when every retry fails', async () => {
    const target = join(workDir, 'index.json');
    vi.spyOn(fs, 'rename').mockImplementation(async () => {
      const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });
    await expect(atomicWriteJson(target, { ok: false })).rejects.toMatchObject({
      code: 'EPERM'
    });
    // Temp file MUST be cleaned up.
    const dirEntries = await fs.readdir(workDir);
    expect(dirEntries.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('does NOT retry on a non-retryable error (e.g. ENOSPC)', async () => {
    const target = join(workDir, 'index.json');
    const spy = vi.spyOn(fs, 'rename').mockImplementation(async () => {
      const err = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    });
    await expect(atomicWriteJson(target, { x: 1 })).rejects.toMatchObject({
      code: 'ENOSPC'
    });
    // Fail-fast: exactly one call.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
