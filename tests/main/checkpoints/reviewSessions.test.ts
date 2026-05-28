/**
 * reviewSessions — PR-style review persistence.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';

const userDataRoot = { path: '' };

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot.path;
      return join(userDataRoot.path, name);
    }
  }
}));

describe('reviewSessions', () => {
  beforeEach(async () => {
    userDataRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-reviews-'));
  });

  afterEach(async () => {
    await rm(userDataRoot.path, { recursive: true, force: true });
  });

  it('creates session, adds comment, sets decision', async () => {
    const {
      ensureReviewSession,
      addReviewComment,
      setReviewDecision,
      getReviewSession
    } = await import('../../../src/main/checkpoints/reviewSessions.js');

    const ws = 'ws-1';
    const conv = 'conv-1';

    const session = await ensureReviewSession({
      workspaceId: ws,
      conversationId: conv,
      runId: 'run-a'
    });
    expect(session.conversationId).toBe(conv);
    expect(session.comments).toEqual([]);

    const comment = await addReviewComment({
      workspaceId: ws,
      conversationId: conv,
      filePath: 'src/a.ts',
      body: '  needs tests  '
    });
    expect(comment.body).toBe('needs tests');

    const decided = await setReviewDecision({
      workspaceId: ws,
      conversationId: conv,
      decision: 'approve',
      filePath: 'src/a.ts'
    });
    expect(decided.decision).toBe('approve');
    expect(decided.fileDecisions?.['src/a.ts']).toBe('approve');

    const loaded = await getReviewSession(ws, conv);
    expect(loaded?.comments).toHaveLength(1);
  });

  it('stores line anchor and git base ref', async () => {
    const {
      ensureReviewSession,
      addReviewComment,
      setReviewGitBaseRef,
      getReviewSession
    } = await import('../../../src/main/checkpoints/reviewSessions.js');

    const ws = 'ws-line';
    const conv = 'conv-line';
    await ensureReviewSession({ workspaceId: ws, conversationId: conv });
    const comment = await addReviewComment({
      workspaceId: ws,
      conversationId: conv,
      filePath: 'a.ts',
      body: 'nit',
      line: 42
    });
    expect(comment.line).toBe(42);
    await setReviewGitBaseRef({ workspaceId: ws, conversationId: conv, ref: 'main' });
    const loaded = await getReviewSession(ws, conv);
    expect(loaded?.gitBaseRef).toBe('main');
  });

  it('does not advance cache when persist fails', async () => {
    const { ensureReviewSession, addReviewComment, getReviewSession } = await import(
      '../../../src/main/checkpoints/reviewSessions.js'
    );

    const ws = 'ws-persist-fail';
    const conv = 'conv-persist-fail';
    await ensureReviewSession({ workspaceId: ws, conversationId: conv });

    const atomic = await import('../../../src/main/checkpoints/atomicWrite.js');
    const spy = vi.spyOn(atomic, 'atomicWriteJson').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      addReviewComment({
        workspaceId: ws,
        conversationId: conv,
        filePath: 'a.ts',
        body: 'should not stick'
      })
    ).rejects.toThrow(/disk full/i);

    const loaded = await getReviewSession(ws, conv);
    expect(loaded?.comments ?? []).toHaveLength(0);
    spy.mockRestore();
  });

  it('rejects empty comment body', async () => {
    const { addReviewComment, ensureReviewSession } = await import(
      '../../../src/main/checkpoints/reviewSessions.js'
    );
    await ensureReviewSession({ workspaceId: 'ws-2', conversationId: 'c-2' });
    await expect(
      addReviewComment({
        workspaceId: 'ws-2',
        conversationId: 'c-2',
        filePath: 'x.ts',
        body: '   '
      })
    ).rejects.toThrow(/empty/i);
  });
});
