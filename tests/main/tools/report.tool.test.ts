/**
 * Integration tests for the `report` tool.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { reportTool } from '@main/tools/report.tool';
import type { ToolContext } from '@main/tools/types';
import { WORKSPACE_DOTDIR, REPORTS_SUBDIR } from '@shared/constants';

function makeCtx(workspacePath: string): ToolContext {
  return {
    workspacePath,
    workspaceId: 'ws-test',
    runId: 'run-test',
    conversationId: 'conv-test',
    signal: new AbortController().signal,
    emit: () => {}
  };
}

describe('report tool', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'vyotiq-report-'));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('writes HTML under .vyotiq/reports/', async () => {
    const result = await reportTool.run(
      { title: 'Q1 Summary', body: '<p>hello</p>' },
      makeCtx(workspacePath)
    );

    expect(result.ok).toBe(true);
    expect(result.data?.tool).toBe('report');
    if (result.data?.tool !== 'report') return;

    const rel = result.data.relPath;
    expect(rel).toMatch(new RegExp(`^${WORKSPACE_DOTDIR}/${REPORTS_SUBDIR}/q1-summary\\.html$`));

    const html = await readFile(join(workspacePath, rel), 'utf8');
    expect(html).toContain('<p>hello</p>');
    expect(html).toContain('Q1 Summary');
    expect(result.data.bytes).toBeGreaterThan(0);
  });

  it('rejects oversize body', async () => {
    const huge = 'x'.repeat(3 * 1024 * 1024);
    const result = await reportTool.run({ title: 'Big', body: huge }, makeCtx(workspacePath));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/exceeds/i);
  });

  it('appends a timestamp suffix when the slug already exists', async () => {
    const ctx = makeCtx(workspacePath);
    const first = await reportTool.run(
      { title: 'Q1 Summary', body: '<p>v1</p>' },
      ctx
    );
    expect(first.ok).toBe(true);
    const second = await reportTool.run(
      { title: 'Q1 Summary', body: '<p>v2</p>' },
      ctx
    );
    expect(second.ok).toBe(true);
    if (second.data?.tool !== 'report' || first.data?.tool !== 'report') return;
    expect(second.data.relPath).not.toBe(first.data.relPath);
    expect(second.data.relPath).toMatch(/q1-summary-\d+\.html$/);
  });
});
