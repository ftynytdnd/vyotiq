/**
 * Bash preflight — workspace symlinks pointing outside are blocked.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bashTool } from '@main/tools/bash.tool';
import { findSymlinksEscapingWorkspace } from '@main/tools/sandbox.js';

function makeCtx(workspacePath: string) {
  return {
    workspacePath,
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
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

describe('bash — symlink escape preflight', () => {
  let workspace: string;
  let outside: string;
  let symlinkOk = false;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-bash-escape-'));
    outside = await mkdtemp(join(tmpdir(), 'vyotiq-bash-out-'));
    await mkdir(join(workspace, 'safe'), { recursive: true });
    await writeFile(join(workspace, 'safe', 'inside.txt'), 'inside', 'utf8');
    await writeFile(join(outside, 'secret.txt'), 'OUTSIDE', 'utf8');
    symlinkOk = await trySymlink(outside, join(workspace, 'escape-dir'));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('findSymlinksEscapingWorkspace lists outside targets', async () => {
    if (!symlinkOk) return;
    const escapes = await findSymlinksEscapingWorkspace(workspace);
    expect(escapes.some((p) => p.includes('escape-dir'))).toBe(true);
  });

  it('bash run is blocked when an escape symlink exists', async () => {
    if (!symlinkOk) return;
    const result = await bashTool.run({ command: 'echo hello' }, makeCtx(workspace));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('symlink-escape');
    expect(result.output).toMatch(/symlink/i);
  });
});
