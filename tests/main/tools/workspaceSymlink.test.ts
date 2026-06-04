/**
 * Integration tests for `ls` and `search` symlink containment.
 * Skips gracefully when the OS forbids symlink creation (common on
 * Windows without developer mode).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatPermissions } from '@shared/types/chat';
import { lsTool } from '@main/tools/ls.tool';
import { searchTool } from '@main/tools/search.tool';
const PERM: ChatPermissions = { allowAuto: true };

function makeCtx(workspacePath: string) {
  return {
    workspacePath,
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    permissions: PERM,
    strictApprovals: false,
    signal: new AbortController().signal,
    emit: () => {}
  };
}

async function trySymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'EPERM') return false;
    throw err;
  }
}

describe('ls + search — symlink containment (disk)', () => {
  let workspace: string;
  let outside: string;
  let symlinkOk = false;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-ws-sym-'));
    outside = await mkdtemp(join(tmpdir(), 'vyotiq-out-sym-'));
    await mkdir(join(workspace, 'safe'), { recursive: true });
    await writeFile(join(workspace, 'safe', 'inside.ts'), 'INSIDE_ONLY_TOKEN', 'utf8');
    await writeFile(join(outside, 'secret.txt'), 'OUTSIDE_ONLY_TOKEN', 'utf8');
    symlinkOk = await trySymlink(outside, join(workspace, 'escape-dir'));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('ls lists in-workspace files and skips symlinked directories', async () => {
    const result = await lsTool.run({}, makeCtx(workspace));
    expect(result.ok).toBe(true);
    expect(result.output).toContain('safe/inside.ts');
    if (symlinkOk) {
      expect(result.output).not.toContain('OUTSIDE_ONLY_TOKEN');
      expect(result.output).not.toContain('secret.txt');
    }
  });

  it('local search does not grep through a symlinked outside directory', async () => {
    if (!symlinkOk) return;
    const result = await searchTool.run(
      { mode: 'local', query: 'OUTSIDE_ONLY_TOKEN' },
      makeCtx(workspace)
    );
    expect(result.ok).toBe(true);
    if (result.data?.tool === 'search') {
      expect(result.data.matches?.length ?? 0).toBe(0);
    }
  });

  it('local search finds tokens in real in-workspace files', async () => {
    const result = await searchTool.run(
      { mode: 'local', query: 'INSIDE_ONLY_TOKEN' },
      makeCtx(workspace)
    );
    expect(result.ok).toBe(true);
    if (result.data?.tool === 'search') {
      expect(result.data.matches?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('local search rejects a symlinked path root via realpathInsideWorkspace', async () => {
    if (!symlinkOk) return;
    const result = await searchTool.run(
      { mode: 'local', query: 'anything', path: 'escape-dir' },
      makeCtx(workspace)
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Sandbox error/);
  });
});

describe('ls — symlinked start path', () => {
  let workspace: string;
  let outside: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-ls-start-'));
    outside = await mkdtemp(join(tmpdir(), 'vyotiq-ls-out-'));
    await mkdir(join(outside, 'nested'), { recursive: true });
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('rejects listing through a symlinked path argument', async () => {
    const linkPath = join(workspace, 'escape');
    const ok = await trySymlink(outside, linkPath);
    if (!ok) return;
    const result = await lsTool.run({ path: 'escape' }, makeCtx(workspace));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Sandbox error/);
  });
});
