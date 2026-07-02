import { describe, expect, it } from 'vitest';
import {
  normalizeTaskItems,
  mergeTaskItems,
  renderTaskListMarkdown,
  countCompleted,
  countActiveTasks,
  buildTaskTree,
  flattenTaskTree,
  detectTaskCycle,
  collectTaskDescendantIds,
  applyHybridParentStatus,
  getTaskChildren,
  TASK_LIST_MAX_ITEMS,
  TASK_CONTENT_MAX_CHARS,
  type TaskItem
} from '@shared/types/task.js';

let seq = 0;
const idFactory = () => `gen-${++seq}`;

describe('normalizeTaskItems', () => {
  it('returns [] for non-array input', () => {
    expect(normalizeTaskItems(undefined, idFactory)).toEqual([]);
    expect(normalizeTaskItems(null, idFactory)).toEqual([]);
    expect(normalizeTaskItems('nope', idFactory)).toEqual([]);
  });

  it('drops blank-content entries and trims content', () => {
    const out = normalizeTaskItems(
      [
        { id: '1', content: '  hello  ', status: 'pending' },
        { id: '2', content: '   ', status: 'pending' },
        { id: '3', content: '', status: 'pending' },
        'garbage',
        null
      ],
      idFactory
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: '1', content: 'hello', status: 'pending' });
  });

  it('clamps unknown statuses to pending', () => {
    const out = normalizeTaskItems([{ id: 'a', content: 'x', status: 'weird' }], idFactory);
    expect(out[0]!.status).toBe('pending');
  });

  it('enforces a single in_progress (demotes later ones)', () => {
    const out = normalizeTaskItems(
      [
        { id: 'a', content: 'a', status: 'in_progress' },
        { id: 'b', content: 'b', status: 'in_progress' },
        { id: 'c', content: 'c', status: 'in_progress' }
      ],
      idFactory
    );
    expect(out.map((t) => t.status)).toEqual(['in_progress', 'pending', 'pending']);
  });

  it('dedupes colliding ids', () => {
    seq = 0;
    const out = normalizeTaskItems(
      [
        { id: 'dup', content: 'first', status: 'pending' },
        { id: 'dup', content: 'second', status: 'pending' }
      ],
      idFactory
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('dup');
    expect(out[1]!.id).not.toBe('dup');
  });

  it('mints an id when missing', () => {
    const out = normalizeTaskItems([{ content: 'no id', status: 'pending' }], idFactory);
    expect(out[0]!.id.length).toBeGreaterThan(0);
  });

  it('caps content length and list length', () => {
    const long = 'x'.repeat(TASK_CONTENT_MAX_CHARS + 50);
    const many = Array.from({ length: TASK_LIST_MAX_ITEMS + 20 }, (_, i) => ({
      id: `i${i}`,
      content: `task ${i}`,
      status: 'pending' as const
    }));
    expect(normalizeTaskItems([{ id: 'x', content: long, status: 'pending' }], idFactory)[0]!.content.length).toBe(
      TASK_CONTENT_MAX_CHARS
    );
    expect(normalizeTaskItems(many, idFactory)).toHaveLength(TASK_LIST_MAX_ITEMS);
  });

  it('accepts parentId and orders depth-first', () => {
    const out = normalizeTaskItems(
      [
        { id: 's1', parentId: 'p1', content: 'Sub one', status: 'pending' },
        { id: 'p1', content: 'Phase', status: 'pending' },
        { id: 's2', parentId: 'p1', content: 'Sub two', status: 'pending' }
      ],
      idFactory
    );
    expect(out.map((t) => t.id)).toEqual(['p1', 's1', 's2']);
    expect(out[1]).toMatchObject({ parentId: 'p1' });
  });

  it('promotes orphans with missing parent to root', () => {
    const out = normalizeTaskItems(
      [{ id: 'c', parentId: 'missing', content: 'orphan', status: 'pending' }],
      idFactory
    );
    expect(out[0]).toMatchObject({ id: 'c', content: 'orphan' });
    expect(out[0]!.parentId).toBeUndefined();
  });

  it('breaks cycles by promoting the cycle node to root', () => {
    const out = normalizeTaskItems(
      [
        { id: 'a', parentId: 'b', content: 'A', status: 'pending' },
        { id: 'b', parentId: 'a', content: 'B', status: 'pending' }
      ],
      idFactory
    );
    expect(detectTaskCycle(out)).toBeNull();
    expect(out.some((t) => t.id === 'a' && !t.parentId)).toBe(true);
  });

  it('leaf wins when parent and child are both in_progress', () => {
    const out = normalizeTaskItems(
      [
        { id: 'p', content: 'Phase', status: 'in_progress' },
        { id: 'c', parentId: 'p', content: 'Step', status: 'in_progress' }
      ],
      idFactory
    );
    expect(out.find((t) => t.id === 'p')?.status).toBe('pending');
    expect(out.find((t) => t.id === 'c')?.status).toBe('in_progress');
  });

  it('auto-completes parent when all children are completed', () => {
    const out = normalizeTaskItems(
      [
        { id: 'p', content: 'Phase', status: 'pending' },
        { id: 'c1', parentId: 'p', content: 'Step 1', status: 'completed' },
        { id: 'c2', parentId: 'p', content: 'Step 2', status: 'completed' }
      ],
      idFactory
    );
    expect(out.find((t) => t.id === 'p')?.status).toBe('completed');
  });

  it('does not override cancelled parent on hybrid complete', () => {
    const items: TaskItem[] = [
      { id: 'p', content: 'Phase', status: 'cancelled' },
      { id: 'c1', parentId: 'p', content: 'Step 1', status: 'completed' }
    ];
    const out = applyHybridParentStatus(items);
    expect(out.find((t) => t.id === 'p')?.status).toBe('cancelled');
  });
});

describe('mergeTaskItems', () => {
  const existing: TaskItem[] = [
    { id: '1', content: 'one', status: 'pending' },
    { id: '2', content: 'two', status: 'pending' }
  ];

  it('updates existing items by id and preserves order', () => {
    const out = mergeTaskItems(existing, [{ id: '1', content: 'one', status: 'completed' }], idFactory);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: '1', status: 'completed' });
    expect(out[1]).toMatchObject({ id: '2', status: 'pending' });
  });

  it('appends unknown ids', () => {
    const out = mergeTaskItems(existing, [{ id: '3', content: 'three', status: 'pending' }], idFactory);
    expect(out.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('merges nested parentId updates', () => {
    const out = mergeTaskItems(
      [{ id: 'p', content: 'Phase', status: 'pending' }],
      [{ id: 's', parentId: 'p', content: 'Step', status: 'pending' }],
      idFactory
    );
    expect(out.map((t) => t.id)).toEqual(['p', 's']);
    expect(out[1]).toMatchObject({ parentId: 'p' });
  });
});

describe('tree helpers', () => {
  const nested: TaskItem[] = [
    { id: 'p1', content: 'Phase 1', status: 'pending' },
    { id: 's1', parentId: 'p1', content: 'Step 1', status: 'completed' },
    { id: 's2', parentId: 'p1', content: 'Step 2', status: 'pending' },
    { id: 'p2', content: 'Phase 2', status: 'pending' }
  ];

  it('getTaskChildren returns direct children in order', () => {
    expect(getTaskChildren(nested, 'p1').map((t) => t.id)).toEqual(['s1', 's2']);
    expect(getTaskChildren(nested, null).map((t) => t.id)).toEqual(['p1', 'p2']);
  });

  it('buildTaskTree and flattenTaskTree round-trip', () => {
    const tree = buildTaskTree(nested);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.children).toHaveLength(2);
    expect(flattenTaskTree(tree).map((t) => t.id)).toEqual(['p1', 's1', 's2', 'p2']);
  });

  it('collectTaskDescendantIds gathers nested ids', () => {
    const ids = collectTaskDescendantIds(nested, 'p1');
    expect([...ids]).toEqual(['s1', 's2']);
  });
});

describe('renderTaskListMarkdown / countCompleted', () => {
  it('renders numbered outline with a progress header', () => {
    const items: TaskItem[] = [
      { id: 'p', content: 'Implement auth', status: 'in_progress' },
      { id: 's1', parentId: 'p', content: 'Read auth module', status: 'completed' },
      { id: 's2', parentId: 'p', content: 'Add login route', status: 'pending' },
      { id: 't', content: 'Write tests', status: 'pending' }
    ];
    const md = renderTaskListMarkdown(items);
    expect(md).toContain('Task plan (1/4 done)');
    expect(md).toContain('1. Implement auth (in progress)');
    expect(md).toContain('1.1 [x] Read auth module');
    expect(md).toContain('1.2 [ ] Add login route');
    expect(md).toContain('2. [ ] Write tests');
  });

  it('renders flat list as numbered outline', () => {
    const items: TaskItem[] = [
      { id: '1', content: 'done one', status: 'completed' },
      { id: '2', content: 'working', status: 'in_progress' },
      { id: '3', content: 'later', status: 'pending' },
      { id: '4', content: 'dropped', status: 'cancelled' }
    ];
    const md = renderTaskListMarkdown(items);
    expect(md).toContain('Task plan (1/3 done)');
    expect(md).toContain('1. [x] done one');
    expect(md).toContain('2. working (in progress)');
    expect(md).toContain('3. [ ] later');
    expect(md).toContain('4. [~] dropped (cancelled)');
    expect(countCompleted(items)).toBe(1);
    expect(countActiveTasks(items)).toBe(3);
  });

  it('returns empty string for an empty list', () => {
    expect(renderTaskListMarkdown([])).toBe('');
  });
});
