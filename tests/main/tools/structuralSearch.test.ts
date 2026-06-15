/**
 * ast-grep structural search — smoke test when native bindings load.
 */

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCanonicalLang } from '@main/astgrep/languageMap.js';
import { inferLanguage } from '@main/astgrep/inferLanguage.js';
import { runStructuralSearch } from '@main/tools/structuralSearch.js';

describe('languageMap', () => {
  it('resolves common language aliases', () => {
    expect(resolveCanonicalLang('typescript')).toBe('typescript');
    expect(resolveCanonicalLang('py')).toBe('python');
    expect(resolveCanonicalLang('rs')).toBe('rust');
    expect(resolveCanonicalLang('not-a-lang')).toBeNull();
  });
});

describe('inferLanguage', () => {
  it('infers from glob extension', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'vyotiq-infer-'));
    try {
      const r = await inferLanguage({ glob: '**/*.py', workspacePath: ws });
      expect(r.lang).toBe('python');
      expect(r.source).toBe('glob');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});

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

  it('line-regex fallback finds Python decorator text', async () => {
    const file = join(ws, 'models.py');
    await fs.writeFile(
      file,
      '@dataclass\nclass Foo:\n  x: int\n',
      'utf8'
    );

    const ac = new AbortController();
    const result = await runStructuralSearch({
      workspacePath: ws,
      rootAbs: ws,
      patternText: '@dataclass',
      language: 'python',
      matcher: 'regex',
      max: 10,
      signal: ac.signal
    });

    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    expect(result.matches[0]?.preview).toMatch(/@dataclass/);
  });

  it('finds nodes by kind when astKind is set', async () => {
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
        patternText: 'function_declaration',
        astKind: 'function_declaration',
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
  });
});
