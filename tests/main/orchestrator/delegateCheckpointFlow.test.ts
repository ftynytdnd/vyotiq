/**
 * Delegate → edit tool → checkpoint pending integration.
 *
 * Exercises `handleDelegates` with a pool stub that runs the real `edit`
 * tool (the same surface sub-agents use) and forwards `onFileEdit`
 * telemetry. Pins the cross-layer contract without provider HTTP or
 * `runSubAgent` streaming.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';

vi.mock('@main/orchestrator/SubAgentPool', () => ({
  runSubAgentPool: vi.fn()
}));

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn(),
  listWorkspaces: vi.fn(async () => ({ activeId: null, workspaces: [] }))
}));

import { runSubAgentPool } from '@main/orchestrator/SubAgentPool';
import { requireWorkspaceById } from '../../../src/main/workspace/workspaceState.js';
import { handleDelegates, type DelegationCounters } from '@main/orchestrator/loop/handleDelegates';
import { editTool } from '@main/tools/edit.tool';
import { openRun, listPending } from '@main/checkpoints/index.js';

function newCtx() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'vyotiq-delegate-ckpt-'));
  const workspaceId = `ws-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  const conversationId = `conv-${randomUUID()}`;
  vi.mocked(requireWorkspaceById).mockResolvedValue(workspaceRoot);
  return { workspaceRoot, workspaceId, runId, conversationId };
}

describe('handleDelegates — delegate edit lands in checkpoint pending', () => {
  beforeEach(() => {
    vi.mocked(requireWorkspaceById).mockReset();
    vi.mocked(runSubAgentPool).mockReset();
  });

  it('records pending changes and timeline events when a delegate edits via the real edit tool', async () => {
    const ctx = newCtx();
    const filePath = 'lib/util.ts';
    const abs = join(ctx.workspaceRoot, filePath);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, 'old line\n', 'utf8');

    await openRun({
      runId: ctx.runId,
      conversationId: ctx.conversationId,
      workspaceId: ctx.workspaceId,
      label: 'delegate run',
      startedAt: Date.now()
    });

    const spec = {
      id: 'A1',
      task: 'Update util.ts',
      files: [filePath],
      tools: ['edit']
    };

    const toolEvents: TimelineEvent[] = [];
    vi.mocked(runSubAgentPool).mockImplementationOnce(async (specs, poolDeps) => {
      const s = specs[0]!;
      const result = await editTool.run(
        { path: filePath, oldString: 'old line', newString: 'new line' },
        {
          workspacePath: ctx.workspaceRoot,
          workspaceId: ctx.workspaceId,
          runId: ctx.runId,
          conversationId: ctx.conversationId,
          permissions: { allowAuto: true },
          strictApprovals: false,
          signal: new AbortController().signal,
          subagentId: s.id,
          emit: (e) => {
            toolEvents.push(e);
          }
        }
      );
      expect(result.ok).toBe(true);

      poolDeps.onFileEdit?.(
        { filePath, additions: 1, deletions: 1 },
        s.id
      );

      return [
        {
          id: s.id,
          task: s.task,
          output:
            '<result><status>success</status><summary>updated util</summary></result>',
          toolResults: [],
          status: 'success' as const
        }
      ];
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    const outcome = await handleDelegates(
      [spec],
      messages,
      counters,
      (e) => events.push(e),
      {
        selection: { providerId: 'p', modelId: 'm' },
        providerName: 'p',
        workspacePath: ctx.workspaceRoot,
        workspaceId: ctx.workspaceId,
        runId: ctx.runId,
        conversationId: ctx.conversationId,
        permissions: { allowAuto: true },
        strictApprovals: false,
        signal: new AbortController().signal
      }
    );

    expect(outcome).toBe('continue');
    expect(await fs.readFile(abs, 'utf8')).toBe('new line\n');

    const pending = await listPending(ctx.conversationId, [ctx.workspaceId]);
    expect(pending).toHaveLength(0);

    const fileEdit = events.find((e) => e.kind === 'file-edit');
    expect(fileEdit).toMatchObject({
      kind: 'file-edit',
      filePath,
      subagentId: 'A1',
      runId: ctx.runId
    });

    expect(toolEvents.some((e) => e.kind === 'checkpoint-entry')).toBe(false);
    expect(
      messages.some(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.includes('<subagent_results>')
      )
    ).toBe(true);
  });
});
