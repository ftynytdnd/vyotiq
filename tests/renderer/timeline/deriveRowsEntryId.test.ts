/**
 * deriveRows — entryId on file-edit rows; legacy worker lifecycle rows
 * are flattened on load via `normalizeLegacyTranscript`.
 */

import { describe, expect, it } from 'vitest';
import { deriveDisplayRows, deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { normalizeLegacyTranscript } from '@shared/transcript/normalizeLegacyTranscript';
import type { TimelineEvent } from '@shared/types/chat';

describe('deriveRows — file-edit entryId', () => {
  it('carries entryId through file-edit-group children', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      { kind: 'agent-text-delta', id: 't1', ts: 2, text: 'plan' },
      {
        kind: 'file-edit',
        id: 'fe1',
        ts: 3,
        runId: 'run-1',
        filePath: 'src/foo.ts',
        additions: 2,
        deletions: 1,
        entryId: 'checkpoint-entry-1'
      }
    ];

    const rows = deriveDisplayRows(events);
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card).toBeDefined();
    if (card?.kind !== 'file-edit-card') return;
    expect(card.entryId).toBe('checkpoint-entry-1');
  });

  it('aggregates edit and file counts on run-complete', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      {
        kind: 'file-edit',
        id: 'fe1',
        ts: 2,
        runId: 'run-1',
        filePath: 'src/a.ts',
        additions: 1,
        deletions: 0
      },
      {
        kind: 'file-edit',
        id: 'fe2',
        ts: 3,
        runId: 'run-1',
        filePath: 'src/b.ts',
        additions: 2,
        deletions: 1
      },
      { kind: 'user-prompt', id: 'p2', ts: 10, content: 'next' }
    ];

    const rows = deriveRows(events);
    expect(rows.some((r) => r.kind === 'run-receipt')).toBe(false);

    const done = rows.find((r) => r.kind === 'run-complete');
    expect(done?.kind).toBe('run-complete');
    if (done?.kind !== 'run-complete') return;
    expect(done.editCount).toBe(2);
    expect(done.fileCount).toBe(2);
    expect(done.durationMs).toBe(2);
  });
});

describe('deriveRows — legacy sub-agent events (flattened on load)', () => {
  it('drops legacy lifecycle rows — no delegation chrome', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'analyze' },
      { kind: 'agent-text-delta', id: 't1', ts: 2, delta: 'Plan' },
      {
        kind: 'subagent-pending',
        id: 'sp1',
        ts: 3,
        subagentId: 'A1',
        task: 'one',
        files: [],
        tools: ['read']
      },
      {
        kind: 'subagent-spawn',
        id: 'ss1',
        ts: 4,
        subagentId: 'A1',
        task: 'one',
        files: [],
        tools: ['read']
      }
    ];

    const rows = deriveRows(normalizeLegacyTranscript(events));
    expect(rows.some((r) => r.kind === 'delegation-plan')).toBe(false);
    expect(rows.some((r) => r.kind === 'subagent-line')).toBe(false);
  });
});
