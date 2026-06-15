/**
 * ast-grep `--debug-query` helper.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { astGrepCliAvailable } from '@main/astgrep/runCli.js';
import { runPatternDebugQuery } from '@main/astgrep/debugQuery.js';

describe('runPatternDebugQuery', () => {
  it('returns parse output for a valid pattern when CLI is available', async () => {
    if (!astGrepCliAvailable()) {
      expect.soft(true).toBe(true);
      return;
    }
    const ws = await mkdtemp(join(tmpdir(), 'vyotiq-debug-'));
    try {
      const ac = new AbortController();
      const out = await runPatternDebugQuery({
        patternText: 'export function $NAME() { $$$ }',
        language: 'typescript',
        workspacePath: ws,
        signal: ac.signal
      });
      expect(out).toBeTruthy();
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
