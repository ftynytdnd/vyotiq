/**
 * Race guard between `appendEvent` and `removeConversation`.
 *
 * AUDIT §3.4 — historically `appendEvent` would auto-create a `'Recovered
 * conversation'` meta when fired against an unknown id. Combined with
 * `chat.ipc.ts:69-77` (which appends every event asynchronously), a
 * `chat:event` racing with `conversations:remove` could resurrect the
 * deleted conversation in the dock. The fix tombstones the id on
 * remove so trailing appends no-op.
 */

import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  createConversation,
  listConversations,
  removeConversation
} from '@main/conversations/conversationStore';

describe('conversationStore — append vs. remove race', () => {
  it('drops trailing appends after remove instead of auto-recovering', async () => {
    const meta = await createConversation('ws-test');
    expect((await listConversations()).map((c) => c.id)).toContain(meta.id);

    await removeConversation(meta.id);
    expect((await listConversations()).map((c) => c.id)).not.toContain(meta.id);

    // This append simulates the in-flight `chat:event` that fired AFTER
    // the user clicked Delete. Pre-fix, this auto-created a new
    // 'Recovered conversation' entry. Post-fix it should silently no-op.
    await appendEvent(meta.id, {
      kind: 'agent-thought',
      id: 'late',
      ts: Date.now(),
      content: 'should not resurrect the conversation'
    });

    const list = await listConversations();
    expect(list.map((c) => c.id)).not.toContain(meta.id);
    // No 'Recovered conversation' entry should appear either.
    expect(list.find((c) => c.title === 'Recovered conversation')).toBeUndefined();
  });
});
