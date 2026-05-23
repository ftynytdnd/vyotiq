/**
 * Bash snapshot cap safety — `computeMutations` truncation guards.
 *
 * When the pre- or post-scan hits `BASH_SNAPSHOT_MAX_ENTRIES`, a path
 * missing from the bounded map must NOT be misclassified as a
 * reversible create/delete (review fix 2026-05-21). These cases route
 * to audit-only or are dropped entirely.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeMutations, type PreSnapshot } from '@main/tools/bash.tool';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vyotiq-bash-trunc-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('bash computeMutations — truncation safety', () => {
  it('routes cap-skipped pre-scan paths to audit-only instead of create', async () => {
    const rel = 'existing.txt';
    const abs = join(workspace, rel);
    await fs.writeFile(abs, 'after-bash\n', 'utf8');
    const st = await fs.stat(abs);

    const pre: PreSnapshot = {
      entries: new Map(),
      truncated: true,
      capturedBytes: 0
    };
    const post = new Map([[abs, st.mtimeMs]]);

    const { mutations, auditOnlyPaths } = await computeMutations(
      workspace,
      pre,
      post,
      false
    );

    expect(mutations).toHaveLength(0);
    expect(auditOnlyPaths).toContain(rel);
  });

  it('does not synthesize delete when post-scan was truncated but file still exists', async () => {
    const rel = 'still-here.txt';
    const abs = join(workspace, rel);
    await fs.writeFile(abs, 'unchanged body\n', 'utf8');
    const st = await fs.stat(abs);

    const pre: PreSnapshot = {
      entries: new Map([
        [
          abs,
          {
            mtimeMs: st.mtimeMs - 1,
            preBody: 'unchanged body\n',
            size: st.size
          }
        ]
      ]),
      truncated: false,
      capturedBytes: 0
    };
    const post = new Map<string, number>();

    const { mutations, auditOnlyPaths } = await computeMutations(
      workspace,
      pre,
      post,
      true
    );

    expect(mutations.filter((m) => m.kind === 'delete')).toHaveLength(0);
    expect(auditOnlyPaths).toHaveLength(0);
    expect(await fs.readFile(abs, 'utf8')).toBe('unchanged body\n');
  });

  it('still records a genuine delete when post-scan truncation and file is gone', async () => {
    const rel = 'removed.txt';
    const abs = join(workspace, rel);
    const pre: PreSnapshot = {
      entries: new Map([
        [
          abs,
          {
            mtimeMs: Date.now(),
            preBody: 'gone now\n',
            size: 10
          }
        ]
      ]),
      truncated: false,
      capturedBytes: 0
    };
    const post = new Map<string, number>();

    const { mutations, auditOnlyPaths } = await computeMutations(
      workspace,
      pre,
      post,
      true
    );

    expect(auditOnlyPaths).toHaveLength(0);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.kind).toBe('delete');
    expect(mutations[0]?.relPath).toBe(rel);
  });
});
