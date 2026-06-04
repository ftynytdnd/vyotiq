/**
 * Edit tool → checkpoint pending integration.
 *
 * Sub-agents execute the same `edit` tool as the orchestrator; a
 * successful edit must land in the per-conversation pending list with
 * the originating `runId` and optional `subagentId`. This closes the
 * delegate/tool/checkpoint gap without spinning up the full sub-agent
 * pool or provider stack.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn(),
  listWorkspaces: vi.fn(async () => ({ activeId: null, workspaces: [] }))
}));

import { requireWorkspaceById } from '../../../src/main/workspace/workspaceState.js';
import { editTool } from '@main/tools/edit.tool';
import { openRun, listPending, getRunManifest } from '@main/checkpoints/index.js';
import type { ToolContext } from '@main/tools/types';

function newCtx() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'vyotiq-edit-pending-'));
  const workspaceId = `ws-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  const conversationId = `conv-${randomUUID()}`;
  vi.mocked(requireWorkspaceById).mockResolvedValue(workspaceRoot);
  return { workspaceRoot, workspaceId, runId, conversationId };
}

function makeToolCtx(
  base: ReturnType<typeof newCtx>,
  overrides: Partial<ToolContext> = {}
): ToolContext {
  return {
    workspacePath: base.workspaceRoot,
    workspaceId: base.workspaceId,
    runId: base.runId,
    conversationId: base.conversationId,
    permissions: { allowAuto: true },
    strictApprovals: false,
    signal: new AbortController().signal,
    emit: () => {},
    ...overrides
  };
}

describe('edit tool — checkpoint pending integration', () => {
  beforeEach(() => {
    vi.mocked(requireWorkspaceById).mockReset();
  });

  it('records a pending change with runId and subagentId after a sub-agent edit', async () => {
    const ctxBase = newCtx();
    const filePath = 'src/feature.ts';
    const abs = join(ctxBase.workspaceRoot, filePath);
    await fs.mkdir(join(ctxBase.workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(abs, 'const v = 1;\n', 'utf8');

    await openRun({
      runId: ctxBase.runId,
      conversationId: ctxBase.conversationId,
      workspaceId: ctxBase.workspaceId,
      label: 'delegate run',
      startedAt: Date.now()
    });

    const events: Array<{ kind: string; subagentId?: string; source?: string }> = [];
    const result = await editTool.run(
      {
        path: filePath,
        oldString: 'const v = 1;',
        newString: 'const v = 2;'
      },
      makeToolCtx(ctxBase, {
        subagentId: 'A1',
        emit: (e) => {
          events.push(e);
        }
      })
    );

    expect(result.ok).toBe(true);
    expect(await fs.readFile(abs, 'utf8')).toBe('const v = 2;\n');

    const pending = await listPending(ctxBase.conversationId, [ctxBase.workspaceId]);
    expect(pending).toHaveLength(0);

    const manifest = await getRunManifest(ctxBase.workspaceId, ctxBase.runId);
    expect(manifest?.entries.length ?? 0).toBe(0);
    expect(events.some((e) => e.kind === 'checkpoint-entry')).toBe(false);
  });
});
