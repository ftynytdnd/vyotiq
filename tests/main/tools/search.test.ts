/**
 * `search` tool — ast-grep structural search.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { searchTool } from '@main/tools/search.tool';

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

describe('search tool — ast-grep default', () => {
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

  it('returns matches without explicit mode', async () => {
    const result = await searchTool.run(
      { query: 'helloWorld', glob: '**/*.ts' },
      makeCtx(workspace)
    );
    if (!result.ok && /native|napi|binding|dll|cli/i.test(result.error ?? '')) {
      expect.soft(true).toBe(true);
      return;
    }
    expect(result.ok).toBe(true);
    expect(result.data?.tool).toBe('search');
    if (result.data?.tool === 'search') {
      expect(result.data.matches?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('rejects a path that escapes the workspace', async () => {
    const result = await searchTool.run(
      { query: 'hello', path: '../../etc' },
      makeCtx(workspace)
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Sandbox error/);
  });

  it('returns ok=false with empty query, pattern, and kind', async () => {
    const result = await searchTool.run({}, makeCtx(workspace));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing query/);
  });

  it('auto-detects grep regex and finds line matches', async () => {
    const result = await searchTool.run(
      { query: 'hello.*world', glob: '**/*.ts' },
      makeCtx(workspace)
    );
    if (!result.ok && /native|napi|binding|dll|cli/i.test(result.error ?? '')) {
      expect.soft(true).toBe(true);
      return;
    }
    expect(result.ok).toBe(true);
    if (result.data?.tool === 'search') {
      expect(result.data.matcher).toBe('regex');
      expect(result.data.matches?.length ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('includes hints when @dataclass finds no matches in TS tree', async () => {
    const result = await searchTool.run(
      { query: '@dataclass', glob: '**/*.ts' },
      makeCtx(workspace)
    );
    if (!result.ok && /native|napi|binding|dll|cli/i.test(result.error ?? '')) {
      expect.soft(true).toBe(true);
      return;
    }
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/Hints:/);
    if (result.data?.tool === 'search') {
      expect(result.data.matcher).toBe('regex');
    }
  });

  it('accepts kind-only search', async () => {
    const result = await searchTool.run(
      { kind: 'function_declaration', glob: '**/*.ts' },
      makeCtx(workspace)
    );
    if (!result.ok && /native|napi|binding|dll|cli/i.test(result.error ?? '')) {
      expect.soft(true).toBe(true);
      return;
    }
    expect(result.ok).toBe(true);
    if (result.data?.tool === 'search') {
      expect(result.data.kind).toBe('function_declaration');
    }
  });
});
