/**
 * `search` tool guard tests — local workspace grep.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatPermissions } from '@shared/types/chat';

import { searchTool } from '@main/tools/search.tool';

const PERM_PROMPT: ChatPermissions = { allowAuto: false };

function makeCtx(workspacePath: string, perms: ChatPermissions) {
  return {
    workspacePath,
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    permissions: perms,
    strictApprovals: false,
    signal: new AbortController().signal,
    emit: () => {}
  };
}

describe('search tool — mode guards', () => {
  it('rejects web mode', async () => {
    const result = await searchTool.run(
      { mode: 'web', query: 'hello' },
      makeCtx('/tmp/ws', PERM_PROMPT)
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid mode/);
  });
});

describe('search tool — local mode', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-search-'));
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'src', 'a.ts'),
      'export function helloWorld() {\n  return 42;\n}\n',
      'utf8'
    );
    await writeFile(
      join(workspace, 'src', 'b.ts'),
      'const noise = "hello world";\nconsole.log(noise);\n',
      'utf8'
    );
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('returns matches across files', async () => {
    const result = await searchTool.run(
      { mode: 'local', query: 'hello' },
      makeCtx(workspace, PERM_PROMPT)
    );
    expect(result.ok).toBe(true);
    expect(result.data?.tool).toBe('search');
    if (result.data?.tool === 'search') {
      expect(result.data.matches?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects a path that escapes the workspace', async () => {
    const result = await searchTool.run(
      { mode: 'local', query: 'hello', path: '../../etc' },
      makeCtx(workspace, PERM_PROMPT)
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Sandbox error/);
  });

  it('returns ok=false with empty query', async () => {
    const result = await searchTool.run(
      { mode: 'local', query: '' },
      makeCtx(workspace, PERM_PROMPT)
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing query/);
  });

  it('honors signal.aborted and surfaces an aborted result', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx = makeCtx(workspace, PERM_PROMPT);
    const result = await searchTool.run(
      { mode: 'local', query: 'hello' },
      { ...ctx, signal: ctrl.signal }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/aborted/);
  });
});
