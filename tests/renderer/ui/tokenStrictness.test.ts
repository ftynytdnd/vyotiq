import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const COLOR_LITERAL =
  /oklch\s*\(|rgba\s*\(|rgb\s*\(|#[0-9a-fA-F]{3,8}\b/g;

/** Strip block + line comments so doc examples do not fail the scan. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function collectFiles(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collectFiles(path, ext, out);
    } else if (ext.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function findLiteralViolations(source: string): string[] {
  const hits: string[] = [];
  const cleaned = stripComments(source);
  for (const match of cleaned.matchAll(COLOR_LITERAL)) {
    const idx = match.index ?? 0;
    const before = cleaned.slice(Math.max(0, idx - 24), idx);
    // `color-mix(in oklch, …)` is token-safe composition, not a raw literal.
    if (before.includes('color-mix(in ')) continue;
    hits.push(match[0]);
  }
  return hits;
}

function indexCssOutsideTheme(): string {
  const css = readFileSync(join(root, 'src/renderer/index.css'), 'utf8');
  const themeEnd = css.indexOf('\n}', css.indexOf('@theme'));
  let outside = css.slice(themeEnd + 2);
  // Dual-theme overrides intentionally carry oklch literals.
  outside = outside.replace(/\[data-theme='light'\][\s\S]*?\n\}/g, '');
  outside = outside.replace(/\[data-density='[^']+'\][\s\S]*?\n\}/g, '');
  // Solid destructive primary (Phase 10) — intentional oklch literals.
  outside = outside.replace(/\.vx-btn-danger-solid[\s\S]*?\n\}/g, '');
  return outside;
}

describe('token strictness', () => {
  it('index.css @theme block is the only place color literals may live in index.css', () => {
    const outside = indexCssOutsideTheme();
    expect(findLiteralViolations(outside)).toEqual([]);
  });

  it('index.css references tokens only (single global stylesheet)', () => {
    const css = readFileSync(join(root, 'src/renderer/index.css'), 'utf8');
    expect(findLiteralViolations(indexCssOutsideTheme())).toEqual([]);
    expect(css).toContain('@theme');
  });

  it('renderer TS/TSX components do not embed color literals', () => {
    const rendererDir = join(root, 'src/renderer');
    const files = collectFiles(rendererDir, /\.(tsx|ts)$/);
    const violations: string[] = [];

    for (const file of files) {
      if (!existsSync(file)) continue;
      const source = readFileSync(file, 'utf8');
      const hits = findLiteralViolations(source);
      if (hits.length > 0) {
        violations.push(`${relative(root, file)}: ${hits.join(', ')}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
