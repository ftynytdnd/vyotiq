/**
 * Pure-helper tests for the pending-changes panel filtering +
 * grouping utilities.
 */

import { describe, expect, it } from 'vitest';
import type { PendingChange } from '@shared/types/checkpoint';
import {
  aggregatePendingStats,
  applyPendingFilters,
  countDistinctFilePaths,
  groupByFilePath,
  groupByFolder,
  groupByRun,
  matchesPathFilter
} from '@renderer/components/checkpoints/pending/groupPendingByPath';

function p(overrides: Partial<PendingChange>): PendingChange {
  return {
    entryId: 'e-1',
    runId: 'r-1',
    conversationId: 'c-1',
    workspaceId: 'w-1',
    filePath: 'src/a.ts',
    kind: 'modify',
    additions: 1,
    deletions: 0,
    createdAt: 0,
    ...overrides
  };
}

describe('groupByRun', () => {
  it('buckets entries by runId in original encounter order', () => {
    const list = [
      p({ entryId: 'a', runId: 'r-1' }),
      p({ entryId: 'b', runId: 'r-2' }),
      p({ entryId: 'c', runId: 'r-1' })
    ];
    const groups = groupByRun(list);
    expect(groups.map((g) => g.runId)).toEqual(['r-1', 'r-2']);
    expect(groups[0]!.entries.map((e) => e.entryId)).toEqual(['a', 'c']);
    expect(groups[1]!.entries.map((e) => e.entryId)).toEqual(['b']);
  });
});

describe('groupByFilePath', () => {
  it('buckets entries by filePath in original encounter order', () => {
    const list = [
      p({ entryId: 'a', filePath: 'src/a.ts' }),
      p({ entryId: 'b', filePath: 'src/b.ts' }),
      p({ entryId: 'c', filePath: 'src/a.ts', additions: 2 })
    ];
    const groups = groupByFilePath(list);
    expect(groups.map((g) => g.filePath)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(groups[0]!.entries.map((e) => e.entryId)).toEqual(['a', 'c']);
    expect(groups[1]!.entries.map((e) => e.entryId)).toEqual(['b']);
  });
});

describe('aggregatePendingStats', () => {
  it('sums additions and deletions across stacked entries', () => {
    const stats = aggregatePendingStats([
      p({ additions: 1, deletions: 2 }),
      p({ additions: 4, deletions: 5 })
    ]);
    expect(stats).toEqual({ additions: 5, deletions: 7 });
  });
});

describe('countDistinctFilePaths', () => {
  it('counts unique file paths', () => {
    expect(
      countDistinctFilePaths([
        p({ entryId: '1', filePath: 'src/a.ts' }),
        p({ entryId: '2', filePath: 'src/a.ts' }),
        p({ entryId: '3', filePath: 'src/b.ts' })
      ])
    ).toBe(2);
  });
});

describe('groupByFolder', () => {
  it('buckets by directory and surfaces root entries under `\"\"`', () => {
    const list = [
      p({ entryId: '1', filePath: 'README.md' }),
      p({ entryId: '2', filePath: 'src/a.ts' }),
      p({ entryId: '3', filePath: 'src/nested/b.ts' }),
      p({ entryId: '4', filePath: 'src/a.test.ts' })
    ];
    const groups = groupByFolder(list);
    // Root bucket is sorted first.
    expect(groups[0]!.folder).toBe('');
    expect(groups[0]!.entries.map((e) => e.entryId)).toEqual(['1']);
    const srcBucket = groups.find((g) => g.folder === 'src');
    expect(srcBucket).toBeDefined();
    expect(srcBucket!.entries.map((e) => e.entryId)).toEqual(['2', '4']);
    const nestedBucket = groups.find((g) => g.folder === 'src/nested');
    expect(nestedBucket!.entries.map((e) => e.entryId)).toEqual(['3']);
  });
});

describe('matchesPathFilter / applyPendingFilters', () => {
  it('matchesPathFilter is case-insensitive and substring-based', () => {
    const change = p({ filePath: 'src/CheckPoints/diff.ts' });
    expect(matchesPathFilter(change, 'checkpoints')).toBe(true);
    expect(matchesPathFilter(change, 'DIFF')).toBe(true);
    expect(matchesPathFilter(change, '')).toBe(true);
    expect(matchesPathFilter(change, 'missing')).toBe(false);
  });

  it('applyPendingFilters AND-combines runId and pathQuery', () => {
    const list = [
      p({ entryId: '1', runId: 'r-1', filePath: 'src/a.ts' }),
      p({ entryId: '2', runId: 'r-2', filePath: 'src/a.ts' }),
      p({ entryId: '3', runId: 'r-1', filePath: 'src/b.ts' })
    ];
    expect(
      applyPendingFilters(list, { runId: 'r-1', pathQuery: '' }).map(
        (e) => e.entryId
      )
    ).toEqual(['1', '3']);
    expect(
      applyPendingFilters(list, { runId: null, pathQuery: 'a.ts' }).map(
        (e) => e.entryId
      )
    ).toEqual(['1', '2']);
    expect(
      applyPendingFilters(list, { runId: 'r-2', pathQuery: 'b.ts' })
    ).toEqual([]);
  });
});
