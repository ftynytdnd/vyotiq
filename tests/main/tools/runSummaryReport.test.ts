import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateRunSummaryReport } from '@main/tools/runSummaryReport';
import { WORKSPACE_DOTDIR, REPORTS_SUBDIR } from '@shared/constants';

describe('generateRunSummaryReport', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'vyotiq-run-summary-'));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('writes a severity-table HTML report for edit events', async () => {
    const result = await generateRunSummaryReport(
      {
        conversationId: 'c1',
        workspaceId: 'w1',
        promptId: 'prompt-abc',
        promptPreview: 'Refactor auth module',
        durationMs: 90_000,
        completedAt: Date.parse('2026-06-06T12:00:00Z'),
        edits: [
          { filePath: 'src/auth.ts', additions: 40, deletions: 5 },
          { filePath: 'src/session.ts', additions: 12, deletions: 2 }
        ]
      },
      workspacePath
    );

    expect(result.ok).toBe(true);
    expect(result.data?.tool).toBe('report');
    if (!result.ok || result.data?.tool !== 'report') return;

    expect(result.data.relPath).toMatch(
      new RegExp(`^${WORKSPACE_DOTDIR}/${REPORTS_SUBDIR}/run-summary-`)
    );

    const html = await readFile(join(workspacePath, result.data.relPath), 'utf8');
    expect(html).toContain('vy-severity-table');
    expect(html).toContain('src/auth.ts');
    expect(html).toContain('Refactor auth module');
  });

  it('fails when there are no edits', async () => {
    const result = await generateRunSummaryReport(
      {
        conversationId: 'c1',
        workspaceId: 'w1',
        promptId: 'p1',
        promptPreview: 'noop',
        durationMs: 1,
        completedAt: Date.now(),
        edits: []
      },
      workspacePath
    );
    expect(result.ok).toBe(false);
  });
});
