/**
 * Integration — `bashTool.run` must reject or rewrite long-running server
 * commands before they can block the shared PTY for minutes.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bashTool } from '@main/tools/bash.tool';
import { BASH_SERVER_START_TIMEOUT_MS } from '@shared/constants.js';

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

describe('bash tool — long-running server guard (integration)', () => {
  it('blocks npm run dev immediately without spawning a shell', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vyotiq-bash-lr-'));
    try {
      const started = Date.now();
      const result = await bashTool.run({ command: 'npm run dev' }, makeCtx(workspace));
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('long-running server');
      expect(result.output).toContain('npm run dev');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('caps timeout for ollama serve rewrites even when the model requests more', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vyotiq-bash-lr-'));
    try {
      const started = Date.now();
      const result = await bashTool.run(
        {
          command: 'ollama serve',
          timeoutMs: 30 * 60 * 1000,
          shared: false
        },
        makeCtx(workspace)
      );
      // Rewritten detached startup must finish within the server-start cap (+ scan slack).
      expect(Date.now() - started).toBeLessThan(BASH_SERVER_START_TIMEOUT_MS + 15_000);
      const data = result.data as { command: string } | undefined;
      expect(data?.command).toBe('ollama serve');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
