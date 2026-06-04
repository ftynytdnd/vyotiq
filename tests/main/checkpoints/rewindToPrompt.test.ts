/**
 * `rewindToPrompt` integration tests — real workspace + JSONL on disk.
 *
 * Pins the atomic rewind contract (revert files, drop pending, trim
 * transcript, delete manifests) and the post-abort `drainAppendChain`
 * barrier that mirrors `chat.ipc.ts` supersede semantics.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TimelineEvent } from '@shared/types/chat.js';

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn(),
  listWorkspaces: vi.fn(async () => ({ activeId: null, workspaces: [] }))
}));

const abortRunsForConversation = vi.fn(() => 0);
vi.mock('../../../src/main/orchestrator/AgentV.js', () => ({
  abortRunsForConversation: (...args: unknown[]) => abortRunsForConversation(...args)
}));

import { requireWorkspaceById } from '../../../src/main/workspace/workspaceState.js';
import {
  appendEvent,
  createConversation,
  drainAppendChain,
  readTranscript
} from '../../../src/main/conversations/conversationStore.js';
import {
  openRun,
  recordChange,
  listPending
} from '../../../src/main/checkpoints/index.js';
import { rewindToPrompt } from '../../../src/main/checkpoints/rewindToPrompt.js';

function newCtx() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'vyotiq-rewind-'));
  const workspaceId = `ws-${randomUUID()}`;
  vi.mocked(requireWorkspaceById).mockResolvedValue(workspaceRoot);
  return { workspaceRoot, workspaceId };
}

function userPrompt(content: string, runId: string): TimelineEvent {
  return {
    kind: 'user-prompt',
    id: randomUUID(),
    ts: Date.now(),
    content,
    runId
  };
}

describe('checkpoints/rewindToPrompt', () => {
  beforeEach(() => {
    vi.mocked(requireWorkspaceById).mockReset();
    abortRunsForConversation.mockReset();
    abortRunsForConversation.mockReturnValue(0);
  });

  it('reverts files, drops pending, and trims the transcript from the boundary prompt', async () => {
    const { workspaceRoot, workspaceId } = newCtx();
    const runId = `run-${randomUUID()}`;
    const meta = await createConversation(workspaceId);

    const promptKeep = userPrompt('keep me', `run-old-${randomUUID()}`);
    promptKeep.ts = Date.now() - 10_000;
    const promptRewind = userPrompt('rewind from here', runId);
    promptRewind.ts = Date.now();

    await appendEvent(meta.id, promptKeep);
    await appendEvent(meta.id, promptRewind);
    await appendEvent(meta.id, {
      kind: 'agent-thought',
      id: randomUUID(),
      ts: Date.now() + 1,
      content: 'tail to remove'
    });

    const filePath = 'src/edit-me.ts';
    const abs = join(workspaceRoot, filePath);
    await fs.mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(abs, 'before\n', 'utf8');

    await openRun({
      runId,
      conversationId: meta.id,
      workspaceId,
      label: 'rewind run',
      startedAt: promptRewind.ts
    });
    await recordChange({
      runId,
      conversationId: meta.id,
      workspaceId,
      filePath,
      kind: 'modify',
      preContent: 'before\n',
      postContent: 'after\n',
      additions: 1,
      deletions: 1,
      source: 'edit',
      emit: () => {}
    });
    await fs.writeFile(abs, 'after\n', 'utf8');

    const broadcasts = {
      checkpointsChanged: vi.fn(),
      transcriptRewound: vi.fn()
    };
    const result = await rewindToPrompt({
      conversationId: meta.id,
      workspaceId,
      promptEventId: promptRewind.id,
      broadcasters: broadcasts
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revertedRunIds).toEqual([]);
    expect(result.removedTranscriptEvents).toBeGreaterThan(0);
    expect(await fs.readFile(abs, 'utf8')).toBe('after\n');

    const events = await readTranscript(meta.id);
    expect(events.some((e) => e.id === promptKeep.id)).toBe(true);
    expect(events.some((e) => e.id === promptRewind.id)).toBe(false);
    expect(broadcasts.checkpointsChanged).toHaveBeenCalledWith(workspaceId);
    expect(broadcasts.transcriptRewound).toHaveBeenCalledWith(meta.id);
  });

  it('awaits drainAppendChain after aborting in-flight runs', async () => {
    const { workspaceId } = newCtx();
    const runId = `run-${randomUUID()}`;
    const meta = await createConversation(workspaceId);

    const promptRewind = userPrompt('boundary', runId);
    await appendEvent(meta.id, promptRewind);

    await openRun({
      runId,
      conversationId: meta.id,
      workspaceId,
      label: 'abort run',
      startedAt: promptRewind.ts
    });

    abortRunsForConversation.mockReturnValue(1);
    const drainSpy = vi.spyOn(
      await import('../../../src/main/conversations/conversationStore.js'),
      'drainAppendChain'
    );

    await rewindToPrompt({
      conversationId: meta.id,
      workspaceId,
      promptEventId: promptRewind.id,
      broadcasters: {
        checkpointsChanged: () => {},
        transcriptRewound: () => {}
      }
    });

    expect(abortRunsForConversation).toHaveBeenCalledWith(meta.id);
    expect(drainSpy).toHaveBeenCalledWith(meta.id);
    drainSpy.mockRestore();
  });

  it('does not leave late tail appends after an aborted rewind trim', async () => {
    const { workspaceRoot, workspaceId } = newCtx();
    const runId = `run-${randomUUID()}`;
    const meta = await createConversation(workspaceId);

    const promptKeep = userPrompt('keep', `run-old-${randomUUID()}`);
    promptKeep.ts = Date.now() - 5_000;
    const promptRewind = userPrompt('rewind', runId);
    promptRewind.ts = Date.now();

    await appendEvent(meta.id, promptKeep);
    await appendEvent(meta.id, promptRewind);

    const filePath = 'note.txt';
    await fs.writeFile(join(workspaceRoot, filePath), 'v1\n', 'utf8');

    await openRun({
      runId,
      conversationId: meta.id,
      workspaceId,
      label: 'race run',
      startedAt: promptRewind.ts
    });
    await recordChange({
      runId,
      conversationId: meta.id,
      workspaceId,
      filePath,
      kind: 'modify',
      preContent: 'v1\n',
      postContent: 'v2\n',
      additions: 1,
      deletions: 1,
      source: 'edit',
      emit: () => {}
    });
    await fs.writeFile(join(workspaceRoot, filePath), 'v2\n', 'utf8');

    abortRunsForConversation.mockReturnValue(1);

    const lateTail: TimelineEvent = {
      kind: 'agent-thought',
      id: 'late-tail',
      ts: Date.now() + 2,
      content: 'must not survive rewind'
    };
    void appendEvent(meta.id, lateTail);

    await rewindToPrompt({
      conversationId: meta.id,
      workspaceId,
      promptEventId: promptRewind.id,
      broadcasters: {
        checkpointsChanged: () => {},
        transcriptRewound: () => {}
      }
    });

    await drainAppendChain(meta.id);
    const events = await readTranscript(meta.id);
    expect(events.some((e) => e.id === 'late-tail')).toBe(false);
    expect(events.some((e) => e.id === promptRewind.id)).toBe(false);
    expect(events.some((e) => e.id === promptKeep.id)).toBe(true);
  });
});
