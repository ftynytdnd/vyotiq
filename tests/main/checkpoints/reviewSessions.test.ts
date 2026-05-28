/**
 * reviewSessions — read-only legacy `reviews.json` loader (Phase 1).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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

async function seedReviewSession(
  workspaceId: string,
  conversationId: string,
  session: Record<string, unknown>
): Promise<void> {
  const { reviewsFile } = await import('../../../src/main/checkpoints/paths.js');
  const path = reviewsFile(workspaceId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ [conversationId]: session }), 'utf8');
}

describe('reviewSessions (read-only)', () => {
  beforeEach(async () => {
    userDataRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-reviews-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(userDataRoot.path, { recursive: true, force: true });
  });

  it('loads an existing session from reviews.json', async () => {
    const ws = 'ws-read';
    const conv = 'conv-read';
    await seedReviewSession(ws, conv, {
      conversationId: conv,
      workspaceId: ws,
      startedAt: 1,
      updatedAt: 2,
      comments: [],
      decision: 'approve'
    });

    const { getReviewSession } = await import('../../../src/main/checkpoints/reviewSessions.js');
    const loaded = await getReviewSession(ws, conv);
    expect(loaded?.decision).toBe('approve');
  });

  it('returns null when no session exists', async () => {
    const { getReviewSession } = await import('../../../src/main/checkpoints/reviewSessions.js');
    expect(await getReviewSession('ws-missing', 'conv-missing')).toBeNull();
  });
});

describe('reviewSessionBlocksSend', () => {
  beforeEach(async () => {
    userDataRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-review-gate-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(userDataRoot.path, { recursive: true, force: true });
  });

  it('returns true when decision is request_changes', async () => {
    const ws = 'ws-gate';
    const conv = 'conv-gate';
    await seedReviewSession(ws, conv, {
      conversationId: conv,
      workspaceId: ws,
      startedAt: 1,
      updatedAt: 2,
      comments: [],
      decision: 'request_changes'
    });

    const { reviewSessionBlocksSend } = await import(
      '../../../src/main/checkpoints/reviewSessions.js'
    );
    expect(await reviewSessionBlocksSend(ws, conv)).toBe(true);
  });

  it('returns false for approve or missing session', async () => {
    const { reviewSessionBlocksSend } = await import(
      '../../../src/main/checkpoints/reviewSessions.js'
    );
    const ws = 'ws-ok';
    const conv = 'conv-ok';
    await seedReviewSession(ws, conv, {
      conversationId: conv,
      workspaceId: ws,
      startedAt: 1,
      updatedAt: 2,
      comments: [],
      decision: 'approve'
    });
    expect(await reviewSessionBlocksSend(ws, conv)).toBe(false);
    expect(await reviewSessionBlocksSend(ws, 'missing')).toBe(false);
  });
});
