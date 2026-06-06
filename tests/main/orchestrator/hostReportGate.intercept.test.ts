import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { createRunStateAccumulator } from '@main/orchestrator/loop/buildRunState';
import { createSpinSignatureBuffer } from '@main/orchestrator/loop/toolSpinSignature';
import { DEFAULT_REPORTS_SETTINGS } from '@shared/report/reportsSettings';

const transcript: TimelineEvent[] = [
  { kind: 'user-prompt', id: 'p1', ts: 1_000, content: 'fix all', runId: 'r1' },
  {
    kind: 'file-edit',
    id: 'e1',
    ts: 2_000,
    runId: 'r1',
    filePath: 'a.ts',
    additions: 4,
    deletions: 1
  },
  {
    kind: 'file-edit',
    id: 'e2',
    ts: 3_000,
    runId: 'r1',
    filePath: 'b.ts',
    additions: 2,
    deletions: 0
  },
  {
    kind: 'file-edit',
    id: 'e3',
    ts: 4_000,
    runId: 'r1',
    filePath: 'c.ts',
    additions: 1,
    deletions: 0
  }
];

vi.mock('@main/conversations/conversationStore.js', () => ({
  readTranscript: vi.fn(async () => transcript)
}));

describe('maybeInterceptHostReportGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pauses with host-report-gate checkpoint when thresholds met', async () => {
    const { maybeInterceptHostReportGate } = await import(
      '@main/orchestrator/loop/hostReportGate.js'
    );
    const emitted: TimelineEvent[] = [];
    const messages: Array<{ role: string; tool_calls?: unknown[] }> = [];
    const runStateAcc = createRunStateAccumulator();

    const result = await maybeInterceptHostReportGate({
      runId: 'r1',
      conversationId: 'c1',
      promptEventId: 'p1',
      reportsSettings: DEFAULT_REPORTS_SETTINGS,
      messages: messages as never,
      query: 'fix all',
      nextIteration: 2,
      consecutiveEmptyTurns: 0,
      injectedStubsHighWater: 0,
      consecutiveErrors: 0,
      consecutiveBadToolRounds: 0,
      runStateAcc,
      spin: createSpinSignatureBuffer(),
      pendingTerminal: 'finish',
      emit: (e) => emitted.push(e)
    });

    expect(result).not.toBeNull();
    expect(result?.pausedForAskUser.hostReportGate).toBe(true);
    expect(result?.pausedForAskUser.reportGateBonusIteration).toBe(true);
    expect(result?.pausedForAskUser.pendingTerminal).toBe('finish');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.kind).toBe('ask-user-prompt');
    if (emitted[0]?.kind === 'ask-user-prompt') {
      expect(emitted[0].source).toBe('host-report-gate');
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('assistant');
    expect(messages[0]?.tool_calls).toHaveLength(1);
  });

  it('skips when promptForReportAfterEdits is off', async () => {
    const { maybeInterceptHostReportGate } = await import(
      '@main/orchestrator/loop/hostReportGate.js'
    );
    const result = await maybeInterceptHostReportGate({
      runId: 'r1',
      conversationId: 'c1',
      promptEventId: 'p1',
      reportsSettings: { ...DEFAULT_REPORTS_SETTINGS, promptForReportAfterEdits: false },
      messages: [] as never,
      query: 'fix all',
      nextIteration: 2,
      consecutiveEmptyTurns: 0,
      injectedStubsHighWater: 0,
      consecutiveErrors: 0,
      consecutiveBadToolRounds: 0,
      runStateAcc: createRunStateAccumulator(),
      spin: createSpinSignatureBuffer(),
      pendingTerminal: 'implicit-finish',
      emit: () => {}
    });
    expect(result).toBeNull();
  });

  it('skips manual replay run ids', async () => {
    const { maybeInterceptHostReportGate } = await import(
      '@main/orchestrator/loop/hostReportGate.js'
    );
    const result = await maybeInterceptHostReportGate({
      runId: 'manual:replay-1',
      conversationId: 'c1',
      promptEventId: 'p1',
      reportsSettings: DEFAULT_REPORTS_SETTINGS,
      messages: [] as never,
      query: 'fix all',
      nextIteration: 2,
      consecutiveEmptyTurns: 0,
      injectedStubsHighWater: 0,
      consecutiveErrors: 0,
      consecutiveBadToolRounds: 0,
      runStateAcc: createRunStateAccumulator(),
      spin: createSpinSignatureBuffer(),
      pendingTerminal: 'finish',
      emit: () => {}
    });
    expect(result).toBeNull();
  });
});
