/**
 * Shared PTY path — agent bash auto-provisions the workspace primary PTY.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ensureWorkspacePty = vi.fn();
const runAgentCommandInPty = vi.fn();

vi.mock('@main/terminal/ptyManager.js', () => ({
  ensureWorkspacePty: (...args: unknown[]) => ensureWorkspacePty(...args),
  runAgentCommandInPty: (...args: unknown[]) => runAgentCommandInPty(...args)
}));

const { bashTool } = await import('@main/tools/bash.tool.js');

function makeCtx(workspacePath: string, workspaceId = 'ws-shared-pty') {
  return {
    workspacePath,
    workspaceId,
    runId: 'run-1',
    conversationId: 'conv-1',
    signal: new AbortController().signal,
    emit: vi.fn()
  };
}

describe('bash tool — shared PTY provisioning', () => {
  beforeEach(() => {
    ensureWorkspacePty.mockReset();
    runAgentCommandInPty.mockReset();
    ensureWorkspacePty.mockReturnValue({
      sessionId: 'sess-1',
      workspaceId: 'ws-shared-pty',
      shell: 'powershell',
      cols: 120,
      rows: 32,
      primary: true
    });
    runAgentCommandInPty.mockResolvedValue({
      output: 'hello',
      exitCode: 0,
      timedOut: false,
      truncated: false
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls ensureWorkspacePty before runAgentCommandInPty on default shared bash', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vyotiq-bash-pty-'));
    try {
      const ctx = makeCtx(workspace);
      const result = await bashTool.run({ command: 'echo hi' }, ctx);

      expect(ensureWorkspacePty).toHaveBeenCalledOnce();
      expect(ensureWorkspacePty).toHaveBeenCalledWith('ws-shared-pty', workspace);
      expect(runAgentCommandInPty).toHaveBeenCalledOnce();
      expect(result.ok).toBe(true);
      const data = result.data as { stdout: string } | undefined;
      expect(data?.stdout).toBe('hello');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('skips shared PTY when shared is false', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'vyotiq-bash-pty-'));
    try {
      const ctx = makeCtx(workspace);
      await bashTool.run({ command: 'echo hi', shared: false }, ctx);

      expect(ensureWorkspacePty).not.toHaveBeenCalled();
      expect(runAgentCommandInPty).not.toHaveBeenCalled();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
