/**
 * `deriveRows` — a `todos-update` event surfaces NO inline timeline row.
 *
 * Structured task state is shown only in the composer task tray (via
 * `useTasksStore`), so the deriver must treat `todos-update` as pure
 * out-of-band telemetry — same as `run-status` / `token-usage`.
 */

import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { isTimelineEvent } from '@renderer/components/timeline/reducer/runtimeGuards';
import type { TimelineEvent } from '@shared/types/chat';

const userPrompt = (ts: number): TimelineEvent => ({
  kind: 'user-prompt',
  id: `u-${ts}`,
  ts,
  content: 'hello'
});

const todosUpdate = (ts: number): TimelineEvent => ({
  kind: 'todos-update',
  id: `t-${ts}`,
  ts,
  conversationId: 'conv-1',
  items: [
    { id: '1', content: 'do thing', status: 'in_progress' },
    { id: '2', content: 'next', status: 'pending' }
  ]
});

describe('deriveRows · todos-update', () => {
  it('produces no row for a todos-update event', () => {
    const rows = deriveRows([userPrompt(1), todosUpdate(2)]);
    expect(rows.some((r) => (r as { kind: string }).kind === 'todos-update')).toBe(false);
    // The user-prompt row is still derived; the todos-update is invisible.
    expect(rows.some((r) => r.kind === 'user-prompt')).toBe(true);
  });

  it('passes the runtime guard with conversationId + items', () => {
    expect(isTimelineEvent(todosUpdate(3))).toBe(true);
    expect(
      isTimelineEvent({ kind: 'todos-update', id: 'x', ts: 1, conversationId: '', items: [] })
    ).toBe(false);
    expect(
      isTimelineEvent({ kind: 'todos-update', id: 'x', ts: 1, conversationId: 'c' })
    ).toBe(false);
  });
});
