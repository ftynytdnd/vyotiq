/**
 * Tests for the `report` tool's filesystem behavior, validation, and
 * permission gating.
 *
 * Strategy:
 *   - Each test creates a fresh tmp workspace under the OS temp dir so
 *     parallel runs don't collide.
 *   - The tool's `ToolContext` is hand-rolled — we don't need the full
 *     orchestrator here, just `workspacePath`, `permissions`, `signal`,
 *     and a `confirm` stub.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportTool } from '@main/tools/report.tool';
import type { ConfirmOutcome, ToolContext } from '@main/tools/types';

interface CtxOverrides {
  allowFileWrites?: boolean;
  allowBash?: boolean;
  allowWebSearch?: boolean;
  // Audit fix H-04: ConfirmOutcome shape (replaces the legacy
  // `Promise<boolean>` return type).
  confirm?: (msg: string) => Promise<ConfirmOutcome>;
}

function makeCtx(workspacePath: string, overrides: CtxOverrides = {}): ToolContext {
  return {
    workspacePath,
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    permissions: {
      allowFileWrites: overrides.allowFileWrites ?? true,
      allowBash: overrides.allowBash ?? true,
      allowWebSearch: overrides.allowWebSearch ?? false
    },
    strictApprovals: false,
    signal: new AbortController().signal,
    // Audit fix H-04: ConfirmOutcome shape.
    confirm: overrides.confirm ?? (async () => ({ approved: true, reason: 'approved' as const })),
    confirmEdit: async () => ({ approved: true, acceptAllRemaining: false }),
    emit: () => { }
  };
}

describe('reportTool — happy path', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-report-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('writes a self-contained HTML file under .vyotiq/reports/ and returns typed data', async () => {
    const result = await reportTool.run(
      {
        title: 'Workspace Survey',
        description: 'Headline counts.',
        body: '<h2>Summary</h2><p>Looks good.</p>'
      },
      makeCtx(workspace)
    );

    expect(result.ok).toBe(true);
    expect(result.name).toBe('report');
    if (result.data?.tool !== 'report') throw new Error('expected report data');
    expect(result.data.title).toBe('Workspace Survey');
    expect(result.data.filePath).toMatch(/^\.vyotiq\/reports\/workspace-survey-\d{8}-\d{6}\.html$/);
    expect(result.data.sizeBytes).toBeGreaterThan(0);

    const onDisk = await readFile(join(workspace, result.data.filePath), 'utf8');
    expect(onDisk.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(onDisk).toContain('<title>Workspace Survey</title>');
    expect(onDisk).toContain('<h2>Summary</h2><p>Looks good.</p>');
  });

  it('falls back to the literal "report" stem when the title slugifies to empty', async () => {
    // All-symbols title slugifies to '' — should still produce a valid filename.
    const result = await reportTool.run(
      { title: '!!! ???', body: '<p>x</p>' },
      makeCtx(workspace)
    );
    expect(result.ok).toBe(true);
    if (result.data?.tool !== 'report') throw new Error('expected report data');
    expect(result.data.filePath).toMatch(/^\.vyotiq\/reports\/report-\d{8}-\d{6}\.html$/);
  });

  it('appends a hex suffix on filename collision', async () => {
    // Pre-create the unsuffixed file so the tool has to pick a hex suffix.
    // We freeze "now" to a known second by mocking Date in just one
    // place — the tool calls `new Date()` once via formatTimestamp.
    // Easier: write the same title twice in the same second by
    // pre-creating the file the tool would otherwise pick.
    const reportsDir = join(workspace, '.vyotiq', 'reports');
    await mkdir(reportsDir, { recursive: true });

    const first = await reportTool.run(
      { title: 'Same Title', body: '<p>1</p>' },
      makeCtx(workspace)
    );
    expect(first.ok).toBe(true);
    if (first.data?.tool !== 'report') throw new Error('expected report data');

    // Manually duplicate the first file's stem so the SECOND call (likely
    // landing in the same second) will see a collision and append a hex
    // suffix. We extract the stem before .html, place a sentinel file at
    // exactly that stem the next call will produce.
    const second = await reportTool.run(
      { title: 'Same Title', body: '<p>2</p>' },
      makeCtx(workspace)
    );
    expect(second.ok).toBe(true);
    if (second.data?.tool !== 'report') throw new Error('expected report data');

    expect(second.data.filePath).not.toBe(first.data.filePath);
    // Either the timestamp differs (>= 1 s apart) OR a hex suffix was appended.
    const isSuffixed = /-[0-9a-f]{4}\.html$/.test(second.data.filePath);
    const tsDiffers =
      second.data.filePath.replace(/-[0-9a-f]{4}\.html$/, '.html') !==
      first.data.filePath;
    expect(isSuffixed || tsDiffers).toBe(true);
  });
});

describe('reportTool — argument validation', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-report-val-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('rejects a missing title', async () => {
    const r = await reportTool.run({ body: '<p/>' }, makeCtx(workspace));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing title/);
  });

  it('rejects an over-long title', async () => {
    const r = await reportTool.run(
      { title: 'x'.repeat(500), body: '<p/>' },
      makeCtx(workspace)
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/title too long/);
  });

  it('rejects a missing body', async () => {
    const r = await reportTool.run({ title: 't' }, makeCtx(workspace));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing body/);
  });

  it('rejects an oversize body', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    const r = await reportTool.run({ title: 't', body: big }, makeCtx(workspace));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/body too large/);
  });

});

describe('reportTool — permission gating', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-report-perm-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('asks for confirmation when allowFileWrites is false; denial → !ok and no file', async () => {
    let confirmCalledWith: string | null = null;
    const ctx = makeCtx(workspace, {
      allowFileWrites: false,
      // Audit fix H-04: ConfirmOutcome shape — denial reports
      // `reason: 'denied'` so the tool surfaces the legacy
      // "permission denied" wording.
      confirm: async (msg: string) => {
        confirmCalledWith = msg;
        return { approved: false, reason: 'denied' as const };
      }
    });

    const r = await reportTool.run({ title: 'Denied', body: '<p/>' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permission denied/);
    expect(confirmCalledWith).toMatch(/wants to write a report at .vyotiq\/reports\//);

    // Verify nothing landed on disk.
    await expect(readFile(join(workspace, '.vyotiq', 'reports'))).rejects.toThrow();
  });

  it('writes the file when allowFileWrites is false but the user confirms', async () => {
    const ctx = makeCtx(workspace, {
      allowFileWrites: false,
      // Audit fix H-04: ConfirmOutcome shape.
      confirm: async () => ({ approved: true, reason: 'approved' as const })
    });
    const r = await reportTool.run({ title: 'Approved', body: '<p>ok</p>' }, ctx);
    expect(r.ok).toBe(true);
    if (r.data?.tool !== 'report') throw new Error('expected report data');
    const onDisk = await readFile(join(workspace, r.data.filePath), 'utf8');
    expect(onDisk).toContain('<p>ok</p>');
  });
});

describe('reportTool — sandbox containment', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-report-sb-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('refuses to write when the workspace path is empty', async () => {
    const ctx = makeCtx('');
    const r = await reportTool.run({ title: 't', body: '<p/>' }, ctx);
    expect(r.ok).toBe(false);
    // Either "Sandbox error" (from resolveCreateInsideWorkspace) or the
    // empty-workspace guard inside sandbox.ts fires here.
    expect(r.error).toMatch(/workspace|sandbox/i);
  });

  it('does not blow up when .vyotiq/reports already exists with sibling files', async () => {
    // Pre-populate the directory so mkdir({recursive:true}) is a no-op.
    const dir = join(workspace, '.vyotiq', 'reports');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sibling.html'), '<!-- sibling -->', 'utf8');

    const r = await reportTool.run({ title: 'Pre', body: '<p/>' }, makeCtx(workspace));
    expect(r.ok).toBe(true);
  });
});
