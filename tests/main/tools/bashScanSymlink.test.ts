/**
 * Sandbox regression — `scanWorkspaceForBash` (the bash tool's pre-
 * snapshot walker) MUST NOT follow symlinks.
 *
 * Review finding H2: a workspace-rooted symlink pointing outside the
 * sandbox (`vendor → /etc`) would otherwise let the scanner pull
 * host file contents into the pending-changes UI on any post-bash
 * mtime flip. The pre-fix walker called `de.isDirectory()` /
 * `de.isFile()` without first filtering `de.isSymbolicLink()`, and
 * relied on `fs.stat` (which follows links) instead of `fs.lstat`.
 *
 * Post-fix contract: every dirent flagged as a symlink is skipped
 * unconditionally — directory symlinks don't push onto the walk
 * stack, file symlinks don't end up in the `entries` map. A symlink
 * that materialises between `readdir` and `stat` (rare race) is
 * caught by a defense-in-depth `lstat` re-check.
 *
 * Cross-platform note: Windows refuses symlink creation without
 * admin / Developer Mode (`EPERM`). When that happens we skip the
 * test gracefully so the suite stays green on default dev machines,
 * matching the same pattern `sandbox.test.ts` uses.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanWorkspaceForBash } from '@main/tools/bash.tool';

let workspace: string;
let outsideRoot: string;
let outsideFile: string;
let outsideDir: string;
let outsideDirFile: string;

beforeAll(async () => {
  const parent = await fs.mkdtemp(join(tmpdir(), 'vyotiq-bash-scan-'));
  workspace = join(parent, 'ws');
  outsideRoot = join(parent, 'outside');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(outsideRoot, { recursive: true });
  // Plant a sentinel file inside the workspace so the scanner has
  // SOMETHING to find — proves the walk itself is healthy.
  await fs.writeFile(join(workspace, 'inside.txt'), 'inside-content');
  // The host-side file the symlink would point to.
  outsideFile = join(outsideRoot, 'secret.txt');
  await fs.writeFile(outsideFile, 'HOST-SECRET-SHOULD-NEVER-BE-CAPTURED');
  // The host-side directory the dir symlink would point to.
  outsideDir = join(outsideRoot, 'tree');
  await fs.mkdir(outsideDir, { recursive: true });
  outsideDirFile = join(outsideDir, 'leaf.txt');
  await fs.writeFile(outsideDirFile, 'HOST-DIR-LEAF-SHOULD-NEVER-BE-CAPTURED');
});

afterAll(async () => {
  try {
    await fs.rm(dirname(workspace), { recursive: true, force: true });
  } catch {
    /* tmp leak is harmless */
  }
});

async function tryMakeSymlink(target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'EPERM') return false;
    throw err;
  }
}

describe('scanWorkspaceForBash — symlink skip (H2 regression)', () => {
  it('includes regular files inside the workspace', async () => {
    const snap = await scanWorkspaceForBash(workspace);
    const insideAbs = join(workspace, 'inside.txt');
    expect(snap.entries.has(insideAbs)).toBe(true);
    expect(snap.entries.get(insideAbs)?.preBody).toBe('inside-content');
  });

  it('skips a file symlink that points OUTSIDE the workspace', async () => {
    const linkPath = join(workspace, 'leak-file-link');
    if (!(await tryMakeSymlink(outsideFile, linkPath))) return;
    try {
      const snap = await scanWorkspaceForBash(workspace);
      // The link itself must not appear in `entries`.
      expect(snap.entries.has(linkPath)).toBe(false);
      // And NO captured body anywhere may contain the host secret.
      for (const entry of snap.entries.values()) {
        expect(entry.preBody ?? '').not.toContain(
          'HOST-SECRET-SHOULD-NEVER-BE-CAPTURED'
        );
      }
    } finally {
      await fs.unlink(linkPath).catch(() => undefined);
    }
  });

  it('skips a directory symlink that points OUTSIDE the workspace', async () => {
    const linkPath = join(workspace, 'leak-dir-link');
    if (!(await tryMakeSymlink(outsideDir, linkPath))) return;
    try {
      const snap = await scanWorkspaceForBash(workspace);
      // No entry for any path under the linked dir.
      for (const abs of snap.entries.keys()) {
        expect(abs.startsWith(linkPath)).toBe(false);
      }
      for (const entry of snap.entries.values()) {
        expect(entry.preBody ?? '').not.toContain(
          'HOST-DIR-LEAF-SHOULD-NEVER-BE-CAPTURED'
        );
      }
    } finally {
      await fs.unlink(linkPath).catch(() => undefined);
    }
  });
});
