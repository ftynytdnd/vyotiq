/**
 * Sandbox regression — `classifyFiles` (private to
 * `loop/handleDelegates.ts`, exported only for this test) MUST treat
 * sibling-prefix paths as `missing`.
 *
 * Review finding H1: the prior implementation used
 * `abs.startsWith(wsRoot)` for the containment gate, which lets
 * `C:\projects\foobar\file.ts` slip through when the workspace is
 * `C:\projects\foo` — the string prefix matches even though the
 * target lives in a sibling directory entirely. The fix routes the
 * candidate through `path.relative` and rejects any `..` prefix or
 * absolute remainder (drive-mismatched paths on Windows).
 *
 * The downstream `inlineFiles` already fails closed via
 * `realpathInsideWorkspace` so the privacy boundary was never
 * breached, but the renderer was lied to: the offending path landed
 * on `subagent-spawn.files[]` as if it were valid. This test pins
 * the post-fix contract so a future refactor can't regress it.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyFiles } from '@main/orchestrator/loop/handleDelegates';

let workspace: string;
let siblingFile: string;

beforeAll(async () => {
  // Create a workspace at `<tmp>/cf-NNN/ws` and a SIBLING directory
  // `<tmp>/cf-NNN/ws-sibling` whose name shares the workspace's
  // prefix. Place a real file in the sibling so the test can prove
  // the gate's classification doesn't depend on the file existing
  // (it must be flagged as missing on containment alone, BEFORE the
  // `fs.access` call).
  const parent = await fs.mkdtemp(join(tmpdir(), 'vyotiq-cf-'));
  workspace = join(parent, 'ws');
  const sibling = join(parent, 'ws-sibling');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(sibling, { recursive: true });
  siblingFile = join(sibling, 'secret.txt');
  await fs.writeFile(siblingFile, 'SHOULD-NEVER-RESOLVE');
  await fs.writeFile(join(workspace, 'inside.txt'), 'inside');
});

afterAll(async () => {
  // Best-effort cleanup of the temp parent.
  try {
    await fs.rm(dirname(workspace), { recursive: true, force: true });
  } catch {
    /* tmp leak is harmless */
  }
});

describe('classifyFiles — sandbox containment', () => {
  it('resolves a real file inside the workspace', async () => {
    const out = await classifyFiles(['inside.txt'], workspace);
    expect(out.resolved).toEqual(['inside.txt']);
    expect(out.missing).toEqual([]);
  });

  it('marks an absolute sibling-prefix path as missing (H1 regression)', async () => {
    // The sibling's absolute path BEGINS with the workspace path as
    // a string prefix (`<parent>/ws` vs `<parent>/ws-sibling`). The
    // legacy `startsWith` check would mis-classify this as
    // `resolved`; the post-fix `path.relative` check rejects it.
    const out = await classifyFiles([siblingFile], workspace);
    expect(out.resolved).toEqual([]);
    expect(out.missing).toEqual([siblingFile]);
  });

  it('marks a relative `..` traversal as missing', async () => {
    const out = await classifyFiles(['../ws-sibling/secret.txt'], workspace);
    expect(out.resolved).toEqual([]);
    expect(out.missing).toEqual(['../ws-sibling/secret.txt']);
  });

  it('marks a non-existent inside-workspace path as missing', async () => {
    const out = await classifyFiles(['does-not-exist.ts'], workspace);
    expect(out.resolved).toEqual([]);
    expect(out.missing).toEqual(['does-not-exist.ts']);
  });

  it('marks empty / whitespace entries as missing', async () => {
    const out = await classifyFiles(['', '   '], workspace);
    expect(out.resolved).toEqual([]);
    expect(out.missing).toEqual(['', '   ']);
  });

  it('preserves order within each bucket', async () => {
    const out = await classifyFiles(
      ['inside.txt', siblingFile, 'does-not-exist.ts'],
      workspace
    );
    expect(out.resolved).toEqual(['inside.txt']);
    expect(out.missing).toEqual([siblingFile, 'does-not-exist.ts']);
  });
});
