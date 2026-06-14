/**
 * `ls` tool integration tests.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lsTool } from '@main/tools/ls.tool';
import type { ToolContext } from '@main/tools/types';

function makeCtx(workspacePath: string): ToolContext {
  return {
    workspacePath,
    workspaceId: 'ws-ls',
    runId: 'run-ls',
    conversationId: 'conv-ls',
    signal: new AbortController().signal,
    emit: () => {}
  };
}

describe('ls tool', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'vyotiq-ls-'));
    await mkdir(join(workspacePath, 'src', 'lib'), { recursive: true });
    await writeFile(join(workspacePath, 'src', 'index.ts'), 'export {};\n', 'utf8');
    await writeFile(join(workspacePath, 'src', 'lib', 'util.ts'), 'export {};\n', 'utf8');
    await mkdir(join(workspacePath, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(workspacePath, 'node_modules', 'pkg', 'index.js'), '', 'utf8');
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('lists workspace tree with depth default', async () => {
    const result = await lsTool.run({}, makeCtx(workspacePath));
    expect(result.ok).toBe(true);
    expect(result.output).toContain('[D] src/');
    expect(result.output).toContain('[F] src/index.ts');
    expect(result.output).not.toContain('node_modules');
  });

  it('respects depth and path', async () => {
    const result = await lsTool.run({ path: 'src', depth: 0 }, makeCtx(workspacePath));
    expect(result.ok).toBe(true);
    expect(result.output).toContain('[F] src/index.ts');
    expect(result.output).toContain('[D] src/lib/');
    expect(result.output).not.toContain('util.ts');
  });

  it('rejects non-directory paths', async () => {
    const result = await lsTool.run({ path: 'src/index.ts' }, makeCtx(workspacePath));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not a directory');
  });
});
