/**
 * `sg` tool validation and CLI smoke tests.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sgTool } from '@main/tools/sg.tool.js';
import { validateToolArgs } from '@main/orchestrator/loop/validateToolArgs.js';
import { astGrepCliAvailable } from '@main/astgrep/runCli.js';

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

describe('sg tool — validateToolArgs', () => {
  it('requires pattern for run', () => {
    const r = validateToolArgs('sg', { action: 'run' });
    expect(r.ok).toBe(false);
  });

  it('requires rulePath or configPath for scan', () => {
    const r = validateToolArgs('sg', { action: 'scan' });
    expect(r.ok).toBe(false);
  });
});

describe('sg tool — run smoke', () => {
  it('runs ast-grep when CLI is available', async () => {
    if (!astGrepCliAvailable()) {
      expect.soft(true).toBe(true);
      return;
    }
    const workspace = await mkdtemp(join(tmpdir(), 'vyotiq-sg-'));
    try {
      const result = await sgTool.run(
        {
          action: 'run',
          pattern: 'export function $NAME',
          language: 'typescript',
          path: '.'
        },
        makeCtx(workspace)
      );
      expect(result.name).toBe('sg');
      expect(result.data?.tool).toBe('sg');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
