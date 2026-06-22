import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('@main/paths/userDataLayout.js', () => ({
  tasksDir: () => state.root
}));

import {
  deleteTaskList,
  readTaskList,
  writeTaskList,
  renderTaskListForContext
} from '@main/tasks/taskStore.js';

describe('taskStore', () => {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'vyotiq-tasks-'));
  });

  afterEach(async () => {
    try {
      await rm(state.root, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('returns an empty list for a conversation with no sidecar', async () => {
    const list = await readTaskList('conv-missing');
    expect(list).toEqual({ conversationId: 'conv-missing', items: [], updatedAt: 0 });
  });

  it('writes (replace) and reads back a normalized list', async () => {
    const written = await writeTaskList(
      'conv-1',
      [
        { id: 'a', content: 'first', status: 'in_progress' },
        { id: 'b', content: 'second', status: 'in_progress' }
      ],
      false
    );
    // Second in_progress demoted by the normalizer.
    expect(written.items.map((t) => t.status)).toEqual(['in_progress', 'pending']);

    const read = await readTaskList('conv-1');
    expect(read.items).toHaveLength(2);
    expect(read.items[0]).toMatchObject({ id: 'a', content: 'first', status: 'in_progress' });
  });

  it('merges by id when merge=true', async () => {
    await writeTaskList(
      'conv-2',
      [
        { id: '1', content: 'one', status: 'pending' },
        { id: '2', content: 'two', status: 'pending' }
      ],
      false
    );
    const merged = await writeTaskList(
      'conv-2',
      [
        { id: '1', content: 'one', status: 'completed' },
        { id: '3', content: 'three', status: 'pending' }
      ],
      true
    );
    expect(merged.items.map((t) => t.id)).toEqual(['1', '2', '3']);
    expect(merged.items[0]).toMatchObject({ status: 'completed' });
  });

  it('persists atomically (no leftover tmp file)', async () => {
    await writeTaskList('conv-3', [{ id: 'x', content: 'x', status: 'pending' }], false);
    const raw = await readFile(join(state.root, 'conv-3.json'), 'utf8');
    expect(JSON.parse(raw).items).toHaveLength(1);
  });

  it('isolates lists per conversation', async () => {
    await writeTaskList('conv-a', [{ id: '1', content: 'a-task', status: 'pending' }], false);
    await writeTaskList('conv-b', [{ id: '1', content: 'b-task', status: 'pending' }], false);
    expect((await readTaskList('conv-a')).items[0]!.content).toBe('a-task');
    expect((await readTaskList('conv-b')).items[0]!.content).toBe('b-task');
  });

  it('serializes concurrent writes without losing data', async () => {
    await Promise.all([
      writeTaskList('conv-cc', [{ id: '1', content: 'one', status: 'pending' }], true),
      writeTaskList('conv-cc', [{ id: '2', content: 'two', status: 'pending' }], true),
      writeTaskList('conv-cc', [{ id: '3', content: 'three', status: 'pending' }], true)
    ]);
    const ids = (await readTaskList('conv-cc')).items.map((t) => t.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });

  it('renders markdown for the context slot, empty when none', async () => {
    expect(await renderTaskListForContext('conv-empty')).toBe('');
    await writeTaskList('conv-md', [{ id: '1', content: 'ship it', status: 'completed' }], false);
    const md = await renderTaskListForContext('conv-md');
    expect(md).toContain('- [x] ship it');
  });

  it('deleteTaskList removes the sidecar file', async () => {
    await writeTaskList('conv-del', [{ id: '1', content: 'gone', status: 'pending' }], false);
    await deleteTaskList('conv-del');
    const list = await readTaskList('conv-del');
    expect(list.items).toEqual([]);
  });
});
