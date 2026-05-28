import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';

const userDataRoot = { path: '' };
const workspaceRoots = new Map<string, string>();

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot.path;
      return join(userDataRoot.path, name);
    }
  }
}));

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: async (id: string) => {
    const p = workspaceRoots.get(id);
    if (!p) throw new Error('unknown workspace');
    return p;
  }
}));

describe('exportReviewSession', () => {
  beforeEach(async () => {
    userDataRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-export-review-'));
    const wsPath = await mkdtemp(join(tmpdir(), 'vyotiq-ws-'));
    workspaceRoots.set('ws-export', wsPath);
  });

  afterEach(async () => {
    await rm(userDataRoot.path, { recursive: true, force: true });
    for (const p of workspaceRoots.values()) {
      await rm(p, { recursive: true, force: true });
    }
    workspaceRoots.clear();
  });

  it('writes bundle JSON beside workspace root', async () => {
    const { ensureReviewSession } = await import('../../../src/main/checkpoints/reviewSessions.js');
    const { exportReviewSession: exportFn } = await import(
      '../../../src/main/checkpoints/exportReview.js'
    );

    await ensureReviewSession({
      workspaceId: 'ws-export',
      conversationId: 'conv-export'
    });

    const result = await exportFn({
      workspaceId: 'ws-export',
      conversationId: 'conv-export'
    });

    expect(result.bytes).toBeGreaterThan(0);
    const raw = await readFile(result.exportPath, 'utf8');
    const parsed = JSON.parse(raw) as { version: number; session: { conversationId: string } };
    expect(parsed.version).toBe(1);
    expect(parsed.session.conversationId).toBe('conv-export');
  });
});
