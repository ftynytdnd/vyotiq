/**
 * Follow-up queue service — CRUD, cap, take/dequeue helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_FOLLOW_UP_QUEUE_DEPTH } from '@shared/constants.js';
import { FollowUpQueueFullError } from '@shared/types/followUp.js';
import {
  _resetFollowUpStoreForTests,
  dropFollowUpsForConversation,
  enqueueFollowUp,
  listFollowUps,
  removeFollowUp,
  takeQueuedFollowUp,
  takeSteeringFollowUp,
  updateFollowUp
} from '@main/followUps/followUpQueueService.js';

let convDir = '';

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: vi.fn()
}));

vi.mock('@main/paths/userDataLayout.js', () => ({
  conversationsDir: () => convDir
}));

describe('followUpQueueService', () => {
  const conversationId = 'conv-test-1';
  const selection = { providerId: 'p1', modelId: 'm1' };

  beforeEach(async () => {
    _resetFollowUpStoreForTests();
    convDir = await mkdtemp(join(tmpdir(), 'vyotiq-followups-'));
  });

  afterEach(async () => {
    _resetFollowUpStoreForTests();
    await rm(convDir, { recursive: true, force: true });
  });

  it('enqueues steering and queued items in separate lanes', async () => {
    await enqueueFollowUp({
      conversationId,
      kind: 'steering',
      prompt: 'steer me',
      selection
    });
    await enqueueFollowUp({
      conversationId,
      kind: 'queue',
      prompt: 'queue me',
      selection
    });
    const state = await listFollowUps(conversationId);
    expect(state.steering).toHaveLength(1);
    expect(state.queued).toHaveLength(1);
    expect(state.steering[0]!.prompt).toBe('steer me');
    expect(state.queued[0]!.prompt).toBe('queue me');
  });

  it('persists dynamic loop follow-up sources', async () => {
    await enqueueFollowUp({
      conversationId,
      kind: 'steering',
      prompt: 'self-continue',
      selection,
      source: 'continue'
    });
    await enqueueFollowUp({
      conversationId,
      kind: 'steering',
      prompt: 'host audit',
      selection,
      source: 'dynamic-loop'
    });
    await enqueueFollowUp({
      conversationId,
      kind: 'steering',
      prompt: 'wake',
      selection,
      source: 'heartbeat'
    });
    const state = await listFollowUps(conversationId);
    expect(state.steering.map((m) => m.source)).toEqual([
      'continue',
      'dynamic-loop',
      'heartbeat'
    ]);
  });

  it('rejects when a lane exceeds max depth', async () => {
    for (let i = 0; i < MAX_FOLLOW_UP_QUEUE_DEPTH; i++) {
      await enqueueFollowUp({
        conversationId,
        kind: 'queue',
        prompt: `q${i}`,
        selection
      });
    }
    await expect(
      enqueueFollowUp({
        conversationId,
        kind: 'queue',
        prompt: 'overflow',
        selection
      })
    ).rejects.toBeInstanceOf(FollowUpQueueFullError);
  });

  it('take helpers dequeue FIFO one steering item at a time and persist to disk', async () => {
    await enqueueFollowUp({ conversationId, kind: 'steering', prompt: 'a', selection });
    await enqueueFollowUp({ conversationId, kind: 'steering', prompt: 'b', selection });
    await enqueueFollowUp({ conversationId, kind: 'queue', prompt: 'q1', selection });
    await enqueueFollowUp({ conversationId, kind: 'queue', prompt: 'q2', selection });

    const firstSteer = await takeSteeringFollowUp(conversationId);
    expect(firstSteer?.prompt).toBe('a');
    const secondSteer = await takeSteeringFollowUp(conversationId);
    expect(secondSteer?.prompt).toBe('b');
    expect(await takeSteeringFollowUp(conversationId)).toBeUndefined();

    const head = await takeQueuedFollowUp(conversationId);
    expect(head?.prompt).toBe('q1');

    const reloaded = await listFollowUps(conversationId);
    expect(reloaded.steering).toHaveLength(0);
    expect(reloaded.queued).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 350));
    const raw = await readFile(join(convDir, `${conversationId}.followups.json`), 'utf8');
    const parsed = JSON.parse(raw) as { queued: { prompt: string }[] };
    expect(parsed.queued[0]!.prompt).toBe('q2');
  });

  it('hydrates from disk when memory is cold', async () => {
    await enqueueFollowUp({ conversationId, kind: 'queue', prompt: 'cold', selection });
    await new Promise((r) => setTimeout(r, 350));
    _resetFollowUpStoreForTests();

    const head = await takeQueuedFollowUp(conversationId);
    expect(head?.prompt).toBe('cold');
  });

  it('update and remove mutate a single item', async () => {
    const state = await enqueueFollowUp({
      conversationId,
      kind: 'queue',
      prompt: 'old',
      selection
    });
    const id = state.queued[0]!.id;
    await updateFollowUp({ conversationId, id, prompt: 'new' });
    const afterUpdate = await listFollowUps(conversationId);
    expect(afterUpdate.queued[0]!.prompt).toBe('new');
    await removeFollowUp(conversationId, id);
    const afterRemove = await listFollowUps(conversationId);
    expect(afterRemove.queued).toHaveLength(0);
  });

  it('update throws when follow-up id is missing', async () => {
    await expect(
      updateFollowUp({ conversationId, id: 'missing', prompt: 'nope' })
    ).rejects.toThrow('Follow-up not found');
  });

  it('filters invalid rows when loading from disk', async () => {
    const path = join(convDir, `${conversationId}.followups.json`);
    await fsWriteFile(
      path,
      JSON.stringify({
        steering: [{ id: 'bad', kind: 'steering', prompt: 1 }],
        queued: [validQueuedRow()]
      }),
      'utf8'
    );
    _resetFollowUpStoreForTests();
    const state = await listFollowUps(conversationId);
    expect(state.steering).toHaveLength(0);
    expect(state.queued).toHaveLength(1);
    expect(state.queued[0]!.prompt).toBe('cold-valid');
  });

  it('drop invalidates debounced persist so file is not recreated', async () => {
    await enqueueFollowUp({ conversationId, kind: 'queue', prompt: 'gone', selection });
    dropFollowUpsForConversation(conversationId);
    await new Promise((r) => setTimeout(r, 350));
    await expect(readFile(join(convDir, `${conversationId}.followups.json`), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
});

function validQueuedRow() {
  return {
    id: 'q-valid',
    kind: 'queue',
    prompt: 'cold-valid',
    selection: { providerId: 'p1', modelId: 'm1' },
    queuedAt: Date.now(),
    source: 'composer'
  };
}
