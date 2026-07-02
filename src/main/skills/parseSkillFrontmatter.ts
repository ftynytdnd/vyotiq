/**
 * Minimal YAML frontmatter parser for SKILL.md files.
 * Supports Agent Skills fields without adding a yaml dependency.
 */

import type { ParsedSkillFrontmatter } from '@shared/types/skills.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function parseScalarValue(raw: string): string | boolean {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parsePathsValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(',')
      .map((p) => parseScalarValue(p))
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
  }
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return trimmed ? [trimmed] : [];
}

function parseFrontmatterBlock(block: string): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1] ?? '';
    let value = match[2] ?? '';
    if (value === '' && i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1] ?? '')) {
      const items: string[] = [];
      i += 1;
      while (i < lines.length && /^\s+-\s+/.test(lines[i] ?? '')) {
        const item = (lines[i] ?? '').replace(/^\s+-\s+/, '').trim();
        if (item) items.push(parseScalarValue(item) as string);
        i += 1;
      }
      out[key] = items;
      continue;
    }
    if (key === 'paths' || key === 'globs') {
      out[key] = parsePathsValue(value);
    } else {
      out[key] = parseScalarValue(value);
    }
    i += 1;
  }
  return out;
}

export function parseSkillFrontmatter(
  raw: string,
  folderName: string
): ParsedSkillFrontmatter | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = FRONTMATTER_RE.exec(raw);
  let meta: Record<string, string | boolean | string[]> = {};
  let body = trimmed;
  if (match) {
    meta = parseFrontmatterBlock(match[1] ?? '');
    body = (match[2] ?? '').trim();
  }

  const nameRaw = meta.name;
  const descRaw = meta.description;
  const name =
    typeof nameRaw === 'string' && nameRaw.trim().length > 0 ? nameRaw.trim() : folderName;
  const description = typeof descRaw === 'string' ? descRaw.trim() : '';

  if (!description) return null;

  const pathsRaw = meta.paths ?? meta.globs;
  const paths = Array.isArray(pathsRaw)
    ? pathsRaw.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : undefined;

  const disableRaw = meta['disable-model-invocation'];
  const disableModelInvocation = disableRaw === true;

  return {
    name,
    description,
    ...(paths?.length ? { paths } : {}),
    ...(disableModelInvocation ? { disableModelInvocation: true } : {}),
    body
  };
}

export function assertSkillNameMatchesFolder(name: string, folderName: string): boolean {
  return name === folderName;
}
