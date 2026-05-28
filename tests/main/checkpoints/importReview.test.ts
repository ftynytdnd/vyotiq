import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const userDataRoot = { path: '' };
const workspaceRoots = new Map<string, string>();

const showMessageBox = vi.fn(async () => ({ response: 1 }));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
    showMessageBox
  },
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

describe('importReviewSession', () => {
  beforeEach(async () => {
    userDataRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-import-review-'));
    const wsPath = await mkdtemp(join(tmpdir(), 'vyotiq-ws-import-'));
    workspaceRoots.set('ws-import', wsPath);
  });

  afterEach(async () => {
    await rm(userDataRoot.path, { recursive: true, force: true });
    for (const p of workspaceRoots.values()) {
      await rm(p, { recursive: true, force: true });
    }
    workspaceRoots.clear();
    vi.clearAllMocks();
  });

  it('imports a valid bundle from an explicit path', async () => {
    const wsPath = workspaceRoots.get('ws-import')!;
    const bundlePath = join(wsPath, 'review-export.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        version: 1,
        exportedAt: 1,
        session: {
          conversationId: 'other-conv',
          workspaceId: 'other-ws',
          startedAt: 1,
          updatedAt: 1,
          reviewerLabel: 'Alice',
          decision: 'request_changes',
          comments: []
        },
        pendingChanges: []
      }),
      'utf8'
    );

    const { importReviewSession } = await import('../../../src/main/checkpoints/importReview.js');
    const { session, applied } = await importReviewSession({
      workspaceId: 'ws-import',
      conversationId: 'conv-target',
      filePath: bundlePath
    });

    expect(applied).toBe('replace');
    expect(session.conversationId).toBe('conv-target');
    expect(session.workspaceId).toBe('ws-import');
    expect(session.reviewerLabel).toBe('Alice');
    expect(session.decision).toBe('request_changes');

    const { getReviewSession } = await import('../../../src/main/checkpoints/reviewSessions.js');
    const stored = await getReviewSession('ws-import', 'conv-target');
    expect(stored?.reviewerLabel).toBe('Alice');
  });

  it('rejects invalid bundle JSON shape', async () => {
    const wsPath = workspaceRoots.get('ws-import')!;
    const bundlePath = join(wsPath, 'bad.json');
    await writeFile(bundlePath, JSON.stringify({ version: 2 }), 'utf8');

    const { importReviewSession } = await import('../../../src/main/checkpoints/importReview.js');
    await expect(
      importReviewSession({
        workspaceId: 'ws-import',
        conversationId: 'conv-target',
        filePath: bundlePath
      })
    ).rejects.toThrow(/Unrecognized review bundle/);
  });

  it('merges when mode is merge and existing session has content', async () => {
    const wsPath = workspaceRoots.get('ws-import')!;
    const { ensureReviewSession, addReviewComment } = await import(
      '../../../src/main/checkpoints/reviewSessions.js'
    );
    await ensureReviewSession({
      workspaceId: 'ws-import',
      conversationId: 'conv-target'
    });
    await addReviewComment({
      workspaceId: 'ws-import',
      conversationId: 'conv-target',
      filePath: 'local.ts',
      body: 'local note'
    });

    const bundlePath = join(wsPath, 'merge.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        version: 1,
        exportedAt: 1,
        session: {
          conversationId: 'other',
          workspaceId: 'ws-import',
          startedAt: 1,
          updatedAt: 1,
          reviewerLabel: 'Bob',
          decision: 'approve',
          comments: [
            { id: 'imp-1', filePath: 'remote.ts', body: 'imported note', ts: 99 }
          ]
        },
        pendingChanges: []
      }),
      'utf8'
    );

    const { importReviewSession } = await import('../../../src/main/checkpoints/importReview.js');
    const { session, applied } = await importReviewSession({
      workspaceId: 'ws-import',
      conversationId: 'conv-target',
      filePath: bundlePath,
      mode: 'merge'
    });

    expect(applied).toBe('merge');
    expect(session.comments).toHaveLength(2);
    expect(session.comments.some((c) => c.body === 'local note')).toBe(true);
    expect(session.comments.some((c) => c.body === 'imported note')).toBe(true);
    expect(session.reviewerLabel).toBe('Bob');
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('prompts merge/replace when existing session has content', async () => {
    const wsPath = workspaceRoots.get('ws-import')!;
    const { ensureReviewSession, addReviewComment } = await import(
      '../../../src/main/checkpoints/reviewSessions.js'
    );
    await ensureReviewSession({
      workspaceId: 'ws-import',
      conversationId: 'conv-target'
    });
    await addReviewComment({
      workspaceId: 'ws-import',
      conversationId: 'conv-target',
      filePath: 'local.ts',
      body: 'keep'
    });

    const bundlePath = join(wsPath, 'prompt.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        version: 1,
        exportedAt: 1,
        session: {
          conversationId: 'conv-target',
          workspaceId: 'ws-import',
          startedAt: 1,
          updatedAt: 1,
          decision: 'approve',
          comments: []
        },
        pendingChanges: []
      }),
      'utf8'
    );

    showMessageBox.mockResolvedValueOnce({ response: 1 });

    const { importReviewSession } = await import('../../../src/main/checkpoints/importReview.js');
    const { applied } = await importReviewSession({
      workspaceId: 'ws-import',
      conversationId: 'conv-target',
      filePath: bundlePath
    });

    expect(showMessageBox).toHaveBeenCalled();
    expect(applied).toBe('replace');
  });

  it('restores pending rows when restorePending is true', async () => {
    const wsPath = workspaceRoots.get('ws-import')!;
    const bundlePath = join(wsPath, 'with-pending.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        version: 1,
        exportedAt: 1,
        session: {
          conversationId: 'conv-target',
          workspaceId: 'ws-import',
          startedAt: 1,
          updatedAt: 1,
          comments: []
        },
        pendingChanges: [
          {
            entryId: 'pend-1',
            runId: 'run-x',
            conversationId: 'other',
            workspaceId: 'other',
            filePath: 'src/imported.ts',
            kind: 'modify',
            preHash: 'a',
            postHash: 'b',
            additions: 1,
            deletions: 0,
            createdAt: 99,
            source: 'edit'
          }
        ]
      }),
      'utf8'
    );

    const { importReviewSession } = await import('../../../src/main/checkpoints/importReview.js');
    const { pendingRestore } = await importReviewSession({
      workspaceId: 'ws-import',
      conversationId: 'conv-target',
      filePath: bundlePath,
      restorePending: true
    });

    expect(pendingRestore).toEqual({ restored: 1, skipped: 0 });
    const { listForConversation } = await import('../../../src/main/checkpoints/pendingChanges.js');
    const pending = await listForConversation('conv-target', ['ws-import']);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.entryId).toBe('pend-1');
    expect(pending[0]?.workspaceId).toBe('ws-import');
  });

  it('skips duplicate entryId when restoring pending', async () => {
    const wsPath = workspaceRoots.get('ws-import')!;
    const { clearWorkspace } = await import('../../../src/main/checkpoints/pendingChanges.js');
    await clearWorkspace('ws-import');
    const { addPending } = await import('../../../src/main/checkpoints/pendingChanges.js');
    await addPending({
      entryId: 'dup-1',
      runId: 'run-local',
      conversationId: 'conv-target',
      workspaceId: 'ws-import',
      filePath: 'local.ts',
      kind: 'modify',
      additions: 0,
      deletions: 0,
      createdAt: 1,
      source: 'edit'
    });

    const bundlePath = join(wsPath, 'dup-pending.json');
    await writeFile(
      bundlePath,
      JSON.stringify({
        version: 1,
        exportedAt: 1,
        session: {
          conversationId: 'conv-target',
          workspaceId: 'ws-import',
          startedAt: 1,
          updatedAt: 1,
          comments: []
        },
        pendingChanges: [
          {
            entryId: 'dup-1',
            runId: 'run-import',
            conversationId: 'conv-target',
            workspaceId: 'ws-import',
            filePath: 'imported.ts',
            kind: 'modify',
            additions: 2,
            deletions: 0,
            createdAt: 2,
            source: 'edit'
          },
          {
            entryId: 'new-1',
            runId: 'run-import',
            conversationId: 'conv-target',
            workspaceId: 'ws-import',
            filePath: 'new.ts',
            kind: 'create',
            additions: 5,
            deletions: 0,
            createdAt: 3,
            source: 'edit'
          }
        ]
      }),
      'utf8'
    );

    const { importReviewSession } = await import('../../../src/main/checkpoints/importReview.js');
    const { pendingRestore } = await importReviewSession({
      workspaceId: 'ws-import',
      conversationId: 'conv-target',
      filePath: bundlePath,
      restorePending: true
    });

    expect(pendingRestore).toEqual({ restored: 1, skipped: 1 });
    const { listForConversation } = await import('../../../src/main/checkpoints/pendingChanges.js');
    const pending = await listForConversation('conv-target', ['ws-import']);
    expect(pending).toHaveLength(2);
    expect(pending.find((p) => p.entryId === 'dup-1')?.filePath).toBe('local.ts');
  });

  it('throws review_import_cancelled when dialog is dismissed', async () => {
    const { importReviewSession } = await import('../../../src/main/checkpoints/importReview.js');
    const { IpcCancelledError } = await import('../../../src/main/ipc/ipcCancelledError.js');

    await expect(
      importReviewSession({
        workspaceId: 'ws-import',
        conversationId: 'conv-target'
      })
    ).rejects.toBeInstanceOf(IpcCancelledError);
  });
});
