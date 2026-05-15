/**
 * Sanity smoke for the main-process test harness.
 * - The electron mock is loaded.
 * - `app.getPath('userData')` returns a real, writable temp directory.
 */

import { describe, it, expect } from 'vitest';
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

describe('main test harness', () => {
  it('exposes a mocked Electron app', () => {
    expect(typeof app.getPath).toBe('function');
    expect(typeof app.getPath('userData')).toBe('string');
  });

  it('userData path is writable', async () => {
    const dir = app.getPath('userData');
    const probe = join(dir, 'probe.txt');
    await fs.writeFile(probe, 'hello', 'utf8');
    const read = await fs.readFile(probe, 'utf8');
    expect(read).toBe('hello');
    await fs.unlink(probe);
  });
});
