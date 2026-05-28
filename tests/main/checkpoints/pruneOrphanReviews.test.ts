/**
 * pruneOrphanedReviewSessions — drop review metadata with no pending/run.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const userDataRoot = { path: '' };

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot.path;
      return join(userDataRoot.path, name);
    }
  }
}));

describe('pruneOrphanedReviewSessions', () => {
  beforeEach(async () => {
    userDataRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-review-prune-'));
  });

  afterEach(async () => {
    await rm(userDataRoot.path, { recursive: true, force: true });
  });

  it('removes review session when pending is empty and run manifest is gone', async () => {
    const { ensureReviewSession, getReviewSession, pruneOrphanedReviewSessions } = await import(
      '../../../src/main/checkpoints/reviewSessions.js'
    );

    const ws = 'ws-prune';
    const conversationId = 'conv-prune';

    await ensureReviewSession({
      workspaceId: ws,
      conversationId,
      runId: 'run-missing'
    });

    const removed = await pruneOrphanedReviewSessions(ws);
    expect(removed).toBe(1);
    expect(await getReviewSession(ws, conversationId)).toBeNull();
  });
});
