/**
 * inferLanguage unit tests.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inferLanguage } from '@main/astgrep/inferLanguage.js';

describe('inferLanguage', () => {
  it('prefers explicit language', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'vyotiq-infer-'));
    try {
      const r = await inferLanguage({ explicit: 'rust', workspacePath: ws });
      expect(r.lang).toBe('rust');
      expect(r.source).toBe('explicit');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it('infers from path extension', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'vyotiq-infer-'));
    try {
      const r = await inferLanguage({ path: 'src/lib.go', workspacePath: ws });
      expect(r.lang).toBe('go');
      expect(r.source).toBe('path');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it('infers from workspace tsconfig', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'vyotiq-infer-'));
    try {
      await writeFile(join(ws, 'tsconfig.json'), '{}', 'utf8');
      const r = await inferLanguage({ workspacePath: ws });
      expect(r.lang).toBe('typescript');
      expect(r.source).toBe('workspace');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
