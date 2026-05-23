/**
 * `search` tool guard tests. Web mode has these privacy / hardening
 * gates we need to keep wired forever:
 *
 *   1. Refuses when the query contains the workspace path (Phase-1
 *      hardening — protects "no file contents outbound" rule). This
 *      is a HARD refusal regardless of `allowAuto`.
 *   2. When `allowAuto` is off, prompts the user to approve each
 *      outbound query; denial → `permission denied`.
 *   3. Refuses when the configured endpoint is non-HTTPS for a
 *      non-localhost host.
 *   4. Refuses when no endpoint is configured.
 *
 * Local mode is exercised separately to confirm grep happy-path and
 * the workspace-containment rejection.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatPermissions } from '@shared/types/chat';
import type { ConfirmOutcome } from '@main/tools/types';

vi.mock('@main/settings/settingsStore', () => ({
  getSettings: vi.fn(async () => ({
    webSearchEndpoint: 'http://evil.example.com/search'
  }))
}));

import { searchTool } from '@main/tools/search.tool';
import { getSettings } from '@main/settings/settingsStore';

/** `allowAuto: false` — every gated tool prompts via `ctx.confirm`. */
const PERM_PROMPT: ChatPermissions = { allowAuto: false };
/** `allowAuto: true` — fully trusted; gated tools run unattended. */
const PERM_AUTO: ChatPermissions = { allowAuto: true };

function makeCtx(
  workspacePath: string,
  perms: ChatPermissions,
  confirm?: (msg: string) => Promise<ConfirmOutcome>
) {
  return {
    workspacePath,
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    permissions: perms,
    strictApprovals: false,
    signal: new AbortController().signal,
    // Audit fix H-04: ConfirmOutcome shape.
    confirm:
      confirm ?? (async () => ({ approved: true, reason: 'approved' as const })),
    confirmEdit: async () => ({ approved: true, acceptAllRemaining: false }),
    emit: () => { }
  };
}

describe('search tool — web mode guards', () => {
  it('prompts the user when allowAuto is off; denial → permission denied', async () => {
    let confirmCalledWith: string | null = null;
    const result = await searchTool.run(
      { mode: 'web', query: 'hello' },
      makeCtx('/tmp/ws', PERM_PROMPT, async (msg) => {
        confirmCalledWith = msg;
        return { approved: false, reason: 'denied' as const };
      })
    );
    expect(confirmCalledWith).toMatch(/web search/i);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permission denied/);
  });

  it('refuses when the query contains the workspace path — hard refusal, no prompt', async () => {
    let confirmCalled = false;
    const result = await searchTool.run(
      { mode: 'web', query: 'errors in /home/user/repo/src/main.ts' },
      makeCtx('/home/user/repo', PERM_PROMPT, async () => {
        confirmCalled = true;
        return { approved: true, reason: 'approved' as const };
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/workspace leak/);
    // Privacy guard fires BEFORE the prompt: a workspace-path leak is
    // a structural bug, not something the user should be asked to
    // approve.
    expect(confirmCalled).toBe(false);
  });

  it('refuses non-HTTPS endpoints when the host is not localhost', async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      webSearchEndpoint: 'http://evil.example.com/search'
    } as never);
    const result = await searchTool.run(
      { mode: 'web', query: 'tailwind v4' },
      makeCtx('/tmp/ws', PERM_AUTO)
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/insecure scheme/);
  });

  it('refuses when no endpoint is configured', async () => {
    vi.mocked(getSettings).mockResolvedValueOnce({
      webSearchEndpoint: ''
    } as never);
    const result = await searchTool.run(
      { mode: 'web', query: 'hi' },
      makeCtx('/tmp/ws', PERM_AUTO)
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no endpoint/);
  });
});

describe('search tool — local mode', () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-search-'));
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(
      join(workspace, 'src', 'a.ts'),
      'export function helloWorld() {\n  return 42;\n}\n',
      'utf8'
    );
    await writeFile(
      join(workspace, 'src', 'b.ts'),
      'const noise = "hello world";\nconsole.log(noise);\n',
      'utf8'
    );
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('returns matches across files', async () => {
    const result = await searchTool.run(
      { mode: 'local', query: 'hello' },
      makeCtx(workspace, PERM_PROMPT)
    );
    expect(result.ok).toBe(true);
    expect(result.data?.tool).toBe('search');
    if (result.data?.tool === 'search') {
      expect(result.data.matches?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects a path that escapes the workspace', async () => {
    const result = await searchTool.run(
      { mode: 'local', query: 'hello', path: '../../etc' },
      makeCtx(workspace, PERM_PROMPT)
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Sandbox error/);
  });

  it('returns ok=false with empty query', async () => {
    const result = await searchTool.run(
      { mode: 'local', query: '' },
      makeCtx(workspace, PERM_PROMPT)
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing query/);
  });

  /**
   * Regression — Cluster 4 audit. The local file-walk used to iterate
   * every candidate from fast-glob without checking the run-scoped
   * AbortSignal between reads. On a large monorepo this meant a user
   * Stop (or a supersede on the orchestrator side) waited for every
   * remaining file to be read before the tool returned. The walk now
   * checks `ctx.signal.aborted` at the top of each iteration and
   * surfaces `ok: false, error: 'aborted'` so callers can distinguish
   * a user-cancelled search from a genuine miss.
   */
  it('honors signal.aborted and surfaces an aborted result', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx = makeCtx(workspace, PERM_PROMPT);
    const result = await searchTool.run(
      { mode: 'local', query: 'hello' },
      { ...ctx, signal: ctrl.signal }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/aborted/);
  });
});
