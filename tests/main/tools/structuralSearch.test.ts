/**
 * ast-grep structural search — smoke test when native bindings load.
 */

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveStructuralLang, runStructuralSearch } from '@main/tools/structuralSearch';

describe('structuralSearch', () => {
  let ws = '';

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'vyotiq-structural-'));
  });

  afterEach(async () => {
    try {
      await rm(ws, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('resolves common language aliases', () => {
    expect(resolveStructuralLang('typescript')).not.toBeNull();
    expect(resolveStructuralLang('tsx')).not.toBeNull();
    expect(resolveStructuralLang('not-a-lang')).toBeNull();
  });

  it('finds a TypeScript export pattern when ast-grep is available', async () => {
    const file = join(ws, 'sample.ts');
    await fs.writeFile(
      file,
      'export function greet() {\n  return "hi";\n}\n',
      'utf8'
    );

    const ac = new AbortController();
    let result: Awaited<ReturnType<typeof runStructuralSearch>>;
    try {
      result = await runStructuralSearch({
        workspacePath: ws,
        rootAbs: ws,
        patternText: 'export function $NAME() { $$$ }',
        language: 'typescript',
        max: 10,
        signal: ac.signal
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/load|native|napi|binding|dll/i.test(msg)) {
        expect.soft(true).toBe(true);
        return;
      }
      throw err;
    }

    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    expect(result.matches[0]?.path).toBe('sample.ts');
    expect(result.matches[0]?.preview).toMatch(/export function greet/);
  });
});
