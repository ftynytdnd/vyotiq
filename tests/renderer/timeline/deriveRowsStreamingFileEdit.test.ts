import { describe, expect, it } from 'vitest';
import {
  applyDeriveRowsLiveLayer,
  deriveDisplayRows,
  deriveRows
} from '@renderer/components/timeline/reducer/deriveRows';
import { synthesizeCreateHunks } from '@shared/text/diff/synthesizeCreateHunks.js';

describe('streaming file edit live layer', () => {
  const baseEvents = [
    {
      kind: 'user-prompt' as const,
      id: 'p1',
      ts: 1,
      content: 'write tests',
      runId: 'r1'
    },
    {
      kind: 'agent-text-delta' as const,
      id: 'a1',
      ts: 2,
      delta: 'Now I will write the files.'
    },
    { kind: 'agent-text-end' as const, id: 'a1', ts: 3 }
  ];

  it('routes edit partials to file-edit-card instead of tool-group', () => {
    const base = deriveRows(baseEvents, { runActive: true });
    const rows = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{"path":"src/a.test.ts","create":true,"content":"describe"}',
          parsed: { path: 'src/a.test.ts', create: true, content: 'describe' },
          ts: 4
        }
      }
    });
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'edit')).toBe(false);
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card?.kind).toBe('file-edit-card');
    if (card?.kind !== 'file-edit-card') throw new Error('narrow');
    expect(card.phase).toBe('streaming');
    expect(card.filePath).toBe('src/a.test.ts');
  });

  it('shows file-edit-pending when path is known but no preview yet', () => {
    const base = deriveRows(baseEvents, { runActive: true });
    const rows = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{"path":"src/a.test.ts"}',
          parsed: { path: 'src/a.test.ts' },
          ts: 4
        }
      }
    });
    const pending = rows.find((r) => r.kind === 'file-edit-pending');
    expect(pending?.kind).toBe('file-edit-pending');
    if (pending?.kind !== 'file-edit-pending') throw new Error('narrow');
    expect(pending.filePath).toBe('src/a.test.ts');
  });

  it('prefers diff-stream hunks over synthesized preview', () => {
    const base = deriveRows(baseEvents, { runActive: true });
    const hunks = synthesizeCreateHunks('line one\nline two\n');
    const rows = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{}',
          parsed: { path: 'src/a.test.ts', create: true },
          ts: 4,
          diffStream: {
            tool: 'edit',
            filePath: 'src/a.test.ts',
            hunks,
            additions: 2,
            deletions: 0,
            settled: false,
            ts: 5
          }
        }
      },
      liveDiffByCallId: {
        c1: {
          tool: 'edit',
          filePath: 'src/a.test.ts',
          hunks,
          additions: 2,
          deletions: 0,
          settled: false,
          ts: 6
        }
      }
    });
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card?.kind).toBe('file-edit-card');
    if (card?.kind !== 'file-edit-card') throw new Error('narrow');
    expect(card.additions).toBe(2);
    expect(card.hunks?.length).toBeGreaterThan(0);
  });

  it('transitions streaming card to settling when diff-stream settles', () => {
    const base = deriveRows(baseEvents, { runActive: true });
    const hunks = synthesizeCreateHunks('line one\n');
    const streaming = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{}',
          parsed: { path: 'src/a.test.ts', create: true },
          ts: 4,
          diffStream: {
            tool: 'edit',
            filePath: 'src/a.test.ts',
            hunks,
            additions: 1,
            deletions: 0,
            settled: false,
            ts: 5
          }
        }
      }
    });
    const liveCard = streaming.find((r) => r.kind === 'file-edit-card');
    expect(liveCard?.kind).toBe('file-edit-card');
    if (liveCard?.kind !== 'file-edit-card') throw new Error('narrow');
    expect(liveCard.phase).toBe('streaming');

    const settling = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{}',
          parsed: { path: 'src/a.test.ts', create: true },
          ts: 4,
          diffStream: {
            tool: 'edit',
            filePath: 'src/a.test.ts',
            hunks,
            additions: 1,
            deletions: 0,
            settled: true,
            ts: 6
          }
        }
      }
    });
    const settlingCard = settling.find((r) => r.kind === 'file-edit-card');
    expect(settlingCard?.kind).toBe('file-edit-card');
    if (settlingCard?.kind !== 'file-edit-card') throw new Error('narrow');
    expect(settlingCard.phase).toBe('settling');
  });

  it('promotes in-flight edit tool-group to file-edit-card after tool-call lands', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: {
          id: 'c1',
          name: 'edit',
          args: { path: 'src/a.test.ts', create: true, content: 'describe' }
        }
      }
    ];
    const base = deriveRows(events, { runActive: true, settledCallIds: { c1: true } });
    const hunks = synthesizeCreateHunks('describe(\'a\', () => {});\n');
    const rows = applyDeriveRowsLiveLayer(base, {
      settledCallIds: { c1: true },
      liveDiffByCallId: {
        c1: {
          tool: 'edit',
          filePath: 'src/a.test.ts',
          hunks,
          additions: 1,
          deletions: 0,
          settled: false,
          ts: 5
        }
      }
    });
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'edit')).toBe(false);
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card?.kind).toBe('file-edit-card');
    if (card?.kind !== 'file-edit-card') throw new Error('narrow');
    expect(card.phase).toBe('streaming');
    expect(card.filePath).toBe('src/a.test.ts');
  });

  it('collapses read/search tool-groups when exploration summary is shown', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      },
      {
        kind: 'tool-call' as const,
        id: 'tc2',
        ts: 6,
        call: { id: 'search1', name: 'search', args: { query: 'foo' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr2',
        ts: 7,
        result: {
          id: 'search1',
          name: 'search',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'search', kind: 'text', query: 'foo', matches: [] }
        }
      }
    ];
    const rows = deriveDisplayRows(events, { runActive: true });
    expect(rows.some((r) => r.kind === 'exploration-summary')).toBe(true);
    expect(
      rows.filter(
        (r) =>
          r.kind === 'tool-group' && (r.toolName === 'read' || r.toolName === 'search')
      ).length
    ).toBe(0);
  });

  it('keeps in-flight read/search tool-groups visible alongside exploration summary', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      },
      {
        kind: 'tool-call' as const,
        id: 'tc2',
        ts: 6,
        call: { id: 'read2', name: 'read', args: { path: 'b.ts' } }
      }
    ];
    const rows = deriveDisplayRows(events, { runActive: true });
    expect(rows.some((r) => r.kind === 'exploration-summary')).toBe(true);
    const runningReads = rows.filter(
      (r) => r.kind === 'tool-group' && r.toolName === 'read'
    );
    expect(runningReads).toHaveLength(1);
    if (runningReads[0]?.kind !== 'tool-group') throw new Error('narrow');
    expect(runningReads[0].children.some((c) => !c.result)).toBe(true);
  });

  it('updates exploration summary counts in place with a stable row key', () => {
    const oneRead = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      }
    ];
    const twoReads = [
      ...oneRead,
      {
        kind: 'tool-call' as const,
        id: 'tc2',
        ts: 6,
        call: { id: 'read2', name: 'read', args: { path: 'b.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr2',
        ts: 7,
        result: {
          id: 'read2',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'b.ts', content: 'y' }
        }
      }
    ];
    const first = deriveDisplayRows(oneRead, { runActive: true });
    const second = deriveDisplayRows(twoReads, { runActive: true });
    const firstSummary = first.find((r) => r.kind === 'exploration-summary');
    const secondSummary = second.find((r) => r.kind === 'exploration-summary');
    expect(firstSummary?.kind).toBe('exploration-summary');
    expect(secondSummary?.kind).toBe('exploration-summary');
    if (firstSummary?.kind !== 'exploration-summary') throw new Error('narrow');
    if (secondSummary?.kind !== 'exploration-summary') throw new Error('narrow');
    expect(firstSummary.key).toBe(secondSummary.key);
    expect(firstSummary.fileCount).toBe(1);
    expect(secondSummary.fileCount).toBe(2);
  });

  it('preserves exploration summary across a second live-layer pass', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      }
    ];
    const base = deriveRows(events, { runActive: true });
    const again = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{"path":"src/a.test.ts"}',
          parsed: { path: 'src/a.test.ts' },
          ts: 6
        }
      }
    });
    expect(again.some((r) => r.kind === 'exploration-summary')).toBe(true);
  });

  it('places streaming card after exploration summary', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      }
    ];
    const base = deriveRows(events, { runActive: true });
    const hunks = synthesizeCreateHunks('describe(\'a\', () => {});\n');
    const rows = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{}',
          parsed: { path: 'src/a.test.ts', create: true },
          ts: 6,
          diffStream: {
            tool: 'edit',
            filePath: 'src/a.test.ts',
            hunks,
            additions: 1,
            deletions: 0,
            settled: false,
            ts: 7
          }
        }
      }
    });
    const summaryIdx = rows.findIndex((r) => r.kind === 'exploration-summary');
    const cardIdx = rows.findIndex((r) => r.kind === 'file-edit-card');
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(cardIdx).toBeGreaterThan(summaryIdx);
  });

  it('places exploration before final prose when edits land before summary on wire', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      },
      {
        kind: 'agent-text-delta' as const,
        id: 'a2',
        ts: 6,
        delta: 'Summary of changes.'
      },
      { kind: 'agent-text-end' as const, id: 'a2', ts: 7 }
    ];
    const rows = deriveDisplayRows(events, { runActive: true });
    const kinds = rows.map((r) => r.kind);
    const summaryIdx = kinds.indexOf('exploration-summary');
    const finalProseIdx = kinds.lastIndexOf('assistant-text');
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeLessThan(finalProseIdx);
  });

  it('places streaming cards after pre-edit prose (mockup order)', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      },
      {
        kind: 'agent-text-delta' as const,
        id: 'a2',
        ts: 6,
        delta: "Now I'll write the test files."
      },
      { kind: 'agent-text-end' as const, id: 'a2', ts: 7 }
    ];
    const base = deriveRows(events, { runActive: true });
    const hunks = synthesizeCreateHunks('line one\n');
    const rows = applyDeriveRowsLiveLayer(base, {
      partialToolCallArgs: {
        c1: {
          callId: 'c1',
          name: 'edit',
          index: 0,
          argsBuf: '{}',
          parsed: { path: 'src/a.test.ts', create: true },
          ts: 8,
          diffStream: {
            tool: 'edit',
            filePath: 'src/a.test.ts',
            hunks,
            additions: 1,
            deletions: 0,
            settled: false,
            ts: 9
          }
        }
      }
    });
    const prose2Idx = rows.findIndex((r) => r.kind === 'assistant-text' && r.id === 'a2');
    const cardIdx = rows.findIndex((r) => r.kind === 'file-edit-card');
    expect(prose2Idx).toBeGreaterThanOrEqual(0);
    expect(cardIdx).toBeGreaterThan(prose2Idx);
  });

  it('keeps settled file cards before final prose when edits precede summary on wire', () => {
    const editCall = {
      kind: 'tool-call' as const,
      id: 'tc-edit',
      ts: 8,
      call: {
        id: 'c1',
        name: 'edit' as const,
        args: { path: 'README.md', oldString: 'old', newString: 'new' }
      }
    };
    const editResult = {
      kind: 'tool-result' as const,
      id: 'tr-edit',
      ts: 9,
      result: {
        id: 'c1',
        name: 'edit' as const,
        ok: true,
        output: 'ok',
        durationMs: 1,
        data: {
          tool: 'edit' as const,
          filePath: 'README.md',
          additions: 3,
          deletions: 1,
          created: false,
          hunks: []
        }
      }
    };
    const fileEdit = {
      kind: 'file-edit' as const,
      id: 'fe1',
      ts: 10,
      filePath: 'README.md',
      additions: 3,
      deletions: 1
    };
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      },
      editCall,
      editResult,
      fileEdit,
      {
        kind: 'agent-text-delta' as const,
        id: 'a2',
        ts: 11,
        delta: 'Summary of changes.'
      },
      { kind: 'agent-text-end' as const, id: 'a2', ts: 12 }
    ];
    const rows = deriveDisplayRows(events);
    const cardIdx = rows.findIndex((r) => r.kind === 'file-edit-card');
    const finalProseIdx = rows.findIndex((r) => r.kind === 'assistant-text' && r.id === 'a2');
    const summaryIdx = rows.findIndex((r) => r.kind === 'exploration-summary');
    expect(cardIdx).toBeGreaterThanOrEqual(0);
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(cardIdx).toBeLessThan(finalProseIdx);
    expect(summaryIdx).toBeLessThan(finalProseIdx);
  });

  it('keeps inline card after tool-result when live diff was cleared', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: {
          id: 'c1',
          name: 'edit',
          args: { path: 'src/a.test.ts', create: true, content: 'describe' }
        }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'c1',
          name: 'edit',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: {
            tool: 'edit',
            filePath: 'src/a.test.ts',
            additions: 2,
            deletions: 0,
            created: true,
            hunks: synthesizeCreateHunks('describe(\'a\', () => {});\n')
          }
        }
      }
    ];
    const rows = deriveDisplayRows(events, { runActive: true, settledCallIds: { c1: true } });
    const card = rows.find((r) => r.kind === 'file-edit-card');
    expect(card?.kind).toBe('file-edit-card');
    if (card?.kind !== 'file-edit-card') throw new Error('narrow');
    expect(['settling', 'settled']).toContain(card.phase);
    expect(rows.some((r) => r.kind === 'tool-group' && r.toolName === 'edit')).toBe(false);
  });

  it('inserts exploration summary after assistant text', () => {
    const events = [
      ...baseEvents,
      {
        kind: 'tool-call' as const,
        id: 'tc1',
        ts: 4,
        call: { id: 'read1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr1',
        ts: 5,
        result: {
          id: 'read1',
          name: 'read',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'read', path: 'a.ts', content: 'x' }
        }
      },
      {
        kind: 'tool-call' as const,
        id: 'tc2',
        ts: 6,
        call: { id: 'search1', name: 'search', args: { query: 'foo' } }
      },
      {
        kind: 'tool-result' as const,
        id: 'tr2',
        ts: 7,
        result: {
          id: 'search1',
          name: 'search',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: { tool: 'search', kind: 'text', query: 'foo', matches: [] }
        }
      }
    ];
    const rows = deriveDisplayRows(events, { runActive: true });
    const summary = rows.find((r) => r.kind === 'exploration-summary');
    expect(summary?.kind).toBe('exploration-summary');
    if (summary?.kind !== 'exploration-summary') throw new Error('narrow');
    expect(summary.fileCount).toBe(1);
    expect(summary.searchCount).toBe(1);
    const assistantIdx = rows.findIndex((r) => r.kind === 'assistant-text');
    const summaryIdx = rows.findIndex((r) => r.kind === 'exploration-summary');
    expect(summaryIdx).toBeGreaterThan(assistantIdx);
  });
});
