import { describe, expect, it } from 'vitest';
import {
  hostReportGateWasShown,
  shouldPromptForReportAfterEdits
} from '@shared/report/runEligibility';
import type { TimelineEvent } from '@shared/types/chat';

const events: TimelineEvent[] = [
  { kind: 'user-prompt', id: 'p1', ts: 1_000, content: 'fix', runId: 'r1' },
  {
    kind: 'file-edit',
    id: 'e1',
    ts: 2_000,
    runId: 'r1',
    filePath: 'a.ts',
    additions: 1,
    deletions: 0
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

describe('runEligibility', () => {
  it('prompts when setting enabled and thresholds met', () => {
    expect(
      shouldPromptForReportAfterEdits(
        { promptId: 'p1', completedAt: 5_000, events, editCount: 3, fileCount: 3 },
        true
      )
    ).toBe(true);
    expect(
      shouldPromptForReportAfterEdits(
        { promptId: 'p1', completedAt: 5_000, events, editCount: 3, fileCount: 3 },
        false
      )
    ).toBe(false);
  });

  it('detects host report gate timeline rows', () => {
    const withGate: TimelineEvent[] = [
      ...events,
      {
        kind: 'ask-user-prompt',
        id: 'ask1',
        ts: 5_000,
        displayText: 'Generate?',
        payload: { questions: [] },
        toolCallId: 'tc1',
        runId: 'r1',
        source: 'host-report-gate'
      }
    ];
    expect(hostReportGateWasShown(withGate, 'r1')).toBe(true);
    expect(hostReportGateWasShown(events, 'r1')).toBe(false);
  });
});
