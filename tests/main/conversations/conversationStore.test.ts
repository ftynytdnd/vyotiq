/**
 * Conversation store tests. The Phase-1 fixes around append + meta
 * ordering and prune draining are the regression surface most worth
 * locking down here.
 *
 * The module is module-level stateful (cached `baseDir`, `indexCache`)
 * — we don't try to reset that between tests. Instead, every test
 * creates its own conversation IDs / events and asserts on the
 * conversation it owns, never on global counts.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import {
  appendEvent,
  createConversation,
  deriveTitleIfFresh,
  flushAll,
  incrementConversationSpend,
  listConversations,
  readTranscript,
  readConversation,
  removeConversation,
  renameConversation,
  setLastModel,
  __test_resetRecordedConversationSpend
} from '@main/conversations/conversationStore';
import type { TimelineEvent } from '@shared/types/chat';

function userTextEvent(content: string): TimelineEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    kind: 'user-prompt',
    ts: Date.now(),
    content
  };
}

describe('conversationStore', () => {
  it('createConversation returns a meta and persists an empty transcript', async () => {
    const meta = await createConversation('ws-test');
    expect(meta.id).toBeTruthy();
    expect(meta.title).toBe('New conversation');
    expect(meta.eventCount).toBe(0);
    const list = await listConversations();
    expect(list.find((c) => c.id === meta.id)).toBeTruthy();
    const events = await readTranscript(meta.id);
    expect(events).toEqual([]);
  });

  it('appendEvent persists each event and bumps eventCount in order', async () => {
    const meta = await createConversation('ws-test');
    await appendEvent(meta.id, userTextEvent('first'));
    await appendEvent(meta.id, userTextEvent('second'));
    await appendEvent(meta.id, userTextEvent('third'));

    const events = await readTranscript(meta.id);
    expect(events).toHaveLength(3);
    expect((events[0] as { content: string }).content).toBe('first');
    expect((events[2] as { content: string }).content).toBe('third');

    await flushAll();
    const list = await listConversations();
    const live = list.find((c) => c.id === meta.id);
    expect(live?.eventCount).toBe(3);
  });

  it('appends from concurrent calls are serialized in arrival order', async () => {
    const meta = await createConversation('ws-test');
    // Fire 10 parallel appends; the per-conversation chain MUST
    // serialize them, otherwise interleaved JSONL would corrupt parse.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        appendEvent(meta.id, userTextEvent(`p-${i}`))
      )
    );
    const events = await readTranscript(meta.id);
    expect(events).toHaveLength(10);
    // Every line should parse cleanly back to a `user-prompt` event.
    for (const e of events) {
      expect(e.kind).toBe('user-prompt');
    }
  });

  it('rename updates the meta in the index', async () => {
    const meta = await createConversation('ws-test');
    const renamed = await renameConversation(meta.id, '   custom name  ');
    expect(renamed.title).toBe('custom name');
    const list = await listConversations();
    expect(list.find((c) => c.id === meta.id)?.title).toBe('custom name');
  });

  it('deriveTitleIfFresh only fires when the title is the default', async () => {
    const meta = await createConversation('ws-test');
    await deriveTitleIfFresh(meta.id, 'Read the README and summarize');
    const after = (await listConversations()).find((c) => c.id === meta.id);
    expect(after?.title).not.toBe('New conversation');
    // A second call must NOT overwrite the previously derived title.
    const previousTitle = after?.title;
    await deriveTitleIfFresh(meta.id, 'Different prompt that should be ignored');
    const stillAfter = (await listConversations()).find((c) => c.id === meta.id);
    expect(stillAfter?.title).toBe(previousTitle);
  });

  it('setLastModel records provider + model on the meta', async () => {
    const meta = await createConversation('ws-test');
    await setLastModel(meta.id, 'openai', 'gpt-4');
    await flushAll();
    const after = (await listConversations()).find((c) => c.id === meta.id);
    expect(after?.lastProviderId).toBe('openai');
    expect(after?.lastModelId).toBe('gpt-4');
  });

  it('appendEvent tracks peak orchestrator prompt tokens on meta', async () => {
    const meta = await createConversation('ws-test');
    const usageEvent = (promptTokens: number): TimelineEvent => ({
      id: `usage-${promptTokens}`,
      kind: 'token-usage',
      ts: Date.now(),
      assistantMsgId: 'asst-1',
      usage: { promptTokens, completionTokens: 1, totalTokens: promptTokens + 1 }
    });
    await appendEvent(meta.id, usageEvent(12_000));
    await appendEvent(meta.id, usageEvent(48_000));
    await appendEvent(meta.id, usageEvent(36_000));
    await flushAll();
    const after = (await listConversations()).find((c) => c.id === meta.id);
    expect(after?.peakPromptTokens).toBe(48_000);
  });

  it('appendEvent records peak from token-usage events', async () => {
    const meta = await createConversation('ws-test');
    await appendEvent(meta.id, {
      id: 'usage-2',
      kind: 'token-usage',
      ts: Date.now(),
      assistantMsgId: 'asst-2',
      usage: { promptTokens: 12_000, completionTokens: 1, totalTokens: 12_001 }
    });
    await flushAll();
    const after = (await listConversations()).find((c) => c.id === meta.id);
    expect(after?.peakPromptTokens).toBe(12_000);
  });

  it('readConversation backfills peakPromptTokens from transcript when meta lacks it', async () => {
    const meta = await createConversation('ws-test');
    const { app } = await import('electron');
    const { join } = await import('node:path');
    const transcriptFile = join(
      app.getPath('userData'),
      'vyotiq',
      'conversations',
      `${meta.id}.jsonl`
    );
    const usageEvent: TimelineEvent = {
      id: 'usage-legacy',
      kind: 'token-usage',
      ts: Date.now(),
      assistantMsgId: 'asst-1',
      usage: { promptTokens: 72_000, completionTokens: 1, totalTokens: 72_001 }
    };
    await fs.appendFile(transcriptFile, JSON.stringify(usageEvent) + '\n', 'utf8');

    const conv = await readConversation(meta.id);
    expect(conv?.peakPromptTokens).toBe(72_000);

    await flushAll();
    const after = (await listConversations()).find((c) => c.id === meta.id);
    expect(after?.peakPromptTokens).toBe(72_000);
  });

  it('reconciles orphan JSONL transcripts missing from index.json on load', async () => {
    const meta = await createConversation('ws-test');
    await appendEvent(meta.id, {
      id: 'ck-orphan-hint',
      kind: 'checkpoint-entry',
      ts: Date.now(),
      entryId: 'ent-1',
      runId: 'run-1',
      conversationId: meta.id,
      workspaceId: 'ws-test',
      filePath: 'src/a.ts',
      changeKind: 'edit',
      additions: 1,
      deletions: 0,
      source: 'edit'
    });
    await appendEvent(meta.id, userTextEvent('Orphan recovery prompt title here'));
    await flushAll();

    const { app } = await import('electron');
    const { join } = await import('node:path');
    const indexFile = join(app.getPath('userData'), 'vyotiq', 'conversations', 'index.json');
    const raw = await fs.readFile(indexFile, 'utf8');
    const parsed = JSON.parse(raw) as Array<{ id: string }>;
    await fs.writeFile(indexFile, JSON.stringify(parsed.filter((m) => m.id !== meta.id)), 'utf8');

    const { __test_resetConversationIndexCacheForTests } = await import(
      '@main/conversations/conversationStore'
    );
    __test_resetConversationIndexCacheForTests();

    const list = await listConversations();
    const recovered = list.find((c) => c.id === meta.id);
    expect(recovered).toBeTruthy();
    expect(recovered?.eventCount).toBe(2);
    expect(recovered?.title).toContain('Orphan recovery');
    expect(recovered?.workspaceId).toBe('ws-test');
  });

  it('removeConversation drops the meta and unlinks the transcript', async () => {
    const meta = await createConversation('ws-test');
    await appendEvent(meta.id, userTextEvent('to be deleted'));
    await flushAll();
    await removeConversation(meta.id);
    const list = await listConversations();
    expect(list.find((c) => c.id === meta.id)).toBeUndefined();
    // readTranscript on a vanished conversation returns []
    const events = await readTranscript(meta.id);
    expect(events).toEqual([]);
  });

  it('readTranscript skips malformed lines instead of throwing', async () => {
    const meta = await createConversation('ws-test');
    await appendEvent(meta.id, userTextEvent('valid-1'));
    // Manually inject a torn line and another valid line to mimic a
    // crash-truncated transcript.
    const path = (await import('@main/conversations/conversationStore')).readTranscript;
    expect(typeof path).toBe('function');
    // We don't have a path accessor; instead sneak in via append + raw.
    const list = await listConversations();
    const live = list.find((c) => c.id === meta.id);
    expect(live).toBeTruthy();
    // Find the on-disk path by re-deriving via app.getPath.
    const { app } = await import('electron');
    const transcriptFile = (await import('node:path')).join(
      app.getPath('userData'),
      'vyotiq',
      'conversations',
      `${meta.id}.jsonl`
    );
    await fs.appendFile(transcriptFile, 'this is not json\n', 'utf8');
    await appendEvent(meta.id, userTextEvent('valid-2'));
    const events = await readTranscript(meta.id);
    // Two valid events; malformed line silently skipped.
    expect(events).toHaveLength(2);
  });

  it('incrementConversationSpend accumulates usage stats idempotently per prompt', async () => {
    __test_resetRecordedConversationSpend();
    const meta = await createConversation('ws-usage');
    const updated = await incrementConversationSpend(meta.id, 'prompt-1', 0.05, {
      cachedTokens: 1200,
      reasoningTokens: 300,
      netCacheSavingsUsd: 0.002,
      lastCacheHitPct: 68
    });
    expect(updated?.estimatedSpendUsd).toBeCloseTo(0.05, 6);
    expect(updated?.runCount).toBe(1);
    expect(updated?.cumulativeCachedTokens).toBe(1200);
    expect(updated?.cumulativeReasoningTokens).toBe(300);
    expect(updated?.cumulativeCacheSavingsUsd).toBeCloseTo(0.002, 6);
    expect(updated?.lastCacheHitPct).toBe(68);

    const again = await incrementConversationSpend(meta.id, 'prompt-1', 0.05, {
      cachedTokens: 9999
    });
    expect(again?.cumulativeCachedTokens).toBe(1200);

    const second = await incrementConversationSpend(meta.id, 'prompt-2', 0.01, {
      cachedTokens: 400
    });
    expect(second?.runCount).toBe(2);
    expect(second?.cumulativeCachedTokens).toBe(1600);
    expect(second?.estimatedSpendUsd).toBeCloseTo(0.06, 6);
    expect(second?.recordedSpendPromptIds).toEqual(['prompt-1', 'prompt-2']);
  });

  it('survives process restart via persisted recordedSpendPromptIds', async () => {
    __test_resetRecordedConversationSpend();
    const meta = await createConversation('ws-restart');
    await incrementConversationSpend(meta.id, 'prompt-1', 0.05);
    __test_resetRecordedConversationSpend();

    const again = await incrementConversationSpend(meta.id, 'prompt-1', 0.05);
    expect(again?.estimatedSpendUsd).toBeCloseTo(0.05, 6);
    expect(again?.runCount).toBe(1);
  });
});
