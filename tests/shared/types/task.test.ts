import { describe, expect, it } from 'vitest';
import {
  normalizeTaskItems,
  mergeTaskItems,
  renderTaskListMarkdown,
  countCompleted,
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
});

describe('renderTaskListMarkdown / countCompleted', () => {
  it('renders GFM checkboxes with a progress header', () => {
    const items: TaskItem[] = [
      { id: '1', content: 'done one', status: 'completed' },
      { id: '2', content: 'working', status: 'in_progress' },
      { id: '3', content: 'later', status: 'pending' },
      { id: '4', content: 'dropped', status: 'cancelled' }
    ];
    const md = renderTaskListMarkdown(items);
    expect(md).toContain('Task plan (1/3 done)');
    expect(md).toContain('- [x] done one');
    expect(md).toContain('- [ ] working (in progress)');
    expect(md).toContain('- [ ] later');
    expect(md).toContain('- [~] dropped (cancelled)');
    expect(countCompleted(items)).toBe(1);
  });

  it('returns empty string for an empty list', () => {
    expect(renderTaskListMarkdown([])).toBe('');
  });
});
