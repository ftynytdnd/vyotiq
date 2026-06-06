import { describe, expect, it } from 'vitest';
import {
  buildRunSummaryInput,
  collectRunFileEdits,
  resolveRunSummaryOfferFromRunId,
  runHadReport,
  shouldOfferRunSummary
} from '@renderer/lib/runSummaryOffer';
import {
  clipRunSummaryPromptPreview,
  RUN_SUMMARY_PROMPT_PREVIEW_MAX_CHARS
} from '@shared/report/deliverables';
import type { TimelineEvent } from '@shared/types/chat';

const baseCtx = {
  conversationId: 'c1',
  workspaceId: 'w1',
  promptId: 'p1',
  durationMs: 60_000,
  completedAt: 5_000
};

describe('runSummaryOffer', () => {
  const events: TimelineEvent[] = [
    { kind: 'user-prompt', id: 'p1', ts: 1_000, content: 'fix all', runId: 'r1' },
    {
      kind: 'file-edit',
      id: 'fe1',
      ts: 2_000,
      runId: 'r1',
      filePath: 'a.ts',
      additions: 4,
      deletions: 1
    },
    {
      kind: 'file-edit',
      id: 'fe2',
      ts: 3_000,
      runId: 'r1',
      filePath: 'b.ts',
      additions: 2,
      deletions: 0
    },
    {
      kind: 'file-edit',
      id: 'fe3',
      ts: 4_000,
      runId: 'r1',
      filePath: 'c.ts',
      additions: 1,
      deletions: 0
    }
  ];

  it('collects file edits for a prompt window', () => {
    expect(collectRunFileEdits(events, 'p1', 5_000)).toHaveLength(3);
  });

  it('offers summary when edit threshold met and no report exists', () => {
    expect(shouldOfferRunSummary({ ...baseCtx, events, editCount: 3, fileCount: 3 })).toBe(
      true
    );
  });

  it('resolves offer context from a terminating run id', () => {
    const offer = resolveRunSummaryOfferFromRunId('r1', 'c1', 'w1', events);
    expect(offer?.promptId).toBe('p1');
    expect(offer?.fileCount).toBe(3);
  });

  it('clips long prompt content before IPC', () => {
    const longPrompt = 'x'.repeat(5_000);
    const longEvents: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1_000, content: longPrompt, runId: 'r1' },
      ...events.slice(1)
    ];
    const input = buildRunSummaryInput({
      ...baseCtx,
      events: longEvents,
      editCount: 3,
      fileCount: 3
    });
    expect(input?.promptPreview.length).toBeLessThanOrEqual(
      RUN_SUMMARY_PROMPT_PREVIEW_MAX_CHARS
    );
    expect(Buffer.byteLength(input!.promptPreview, 'utf8')).toBeLessThanOrEqual(1024);
    expect(clipRunSummaryPromptPreview(longPrompt).endsWith('…')).toBe(true);
  });

  it('skips offer when a report tool already ran', () => {
    const withReport: TimelineEvent[] = [
      ...events,
      {
        kind: 'tool-result',
        id: 'tr1',
        ts: 4_500,
        result: {
          id: 'tr1',
          name: 'report',
          ok: true,
          output: 'ok',
          data: { tool: 'report', title: 'T', relPath: '.vyotiq/reports/t.html', bytes: 1 },
          durationMs: 1
        }
      }
    ];
    expect(runHadReport(withReport, 'p1', 5_000)).toBe(true);
    expect(
      shouldOfferRunSummary({ ...baseCtx, events: withReport, editCount: 3, fileCount: 3 })
    ).toBe(false);
  });
});
