/**
 * Skill registry — merges bundled skills with discovered filesystem skills.
 */

import { promises as fs } from 'node:fs';
import type { SkillMeta } from '@shared/types/skills.js';
import {
  MAX_CATALOGUE_SKILLS,
  MAX_SKILL_BODY_BYTES,
  isBundledSkillName,
  type BundledSkillName
} from '@shared/types/skills.js';
import { listBundledSkillMetas, getBundledSkillBody, readBundledSkillRaw } from './bundledSkills.js';
import { discoverSkillsFromDisk } from './skillDiscovery.js';
import { parseSkillFrontmatter } from './parseSkillFrontmatter.js';
import { readSkillOverride } from './skillOverrides.js';
import { logger } from '../logging/logger.js';

const log = logger.child('skills/registry');

interface RegistryCache {
  workspacePath: string;
  skills: SkillMeta[];
}

let cache: RegistryCache | null = null;

export function invalidateSkillRegistry(): void {
  cache = null;
}

function mergeWithBundled(discovered: SkillMeta[]): SkillMeta[] {
  const bundled = listBundledSkillMetas();
  const byName = new Map<string, SkillMeta>();
  for (const b of bundled) {
    byName.set(b.name, b);
  }
  for (const d of discovered) {
    byName.set(d.name, d);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listSkills(workspacePath?: string): Promise<SkillMeta[]> {
  const ws = workspacePath?.trim() ?? '';
  if (cache && cache.workspacePath === ws) {
    return cache.skills;
  }
  const discovered = ws ? await discoverSkillsFromDisk({ workspacePath: ws }) : [];
  const merged = mergeWithBundled(discovered);
  cache = { workspacePath: ws, skills: merged };
  return merged;
}

export function filterCatalogueVisibleSkills(
  skills: readonly SkillMeta[],
  invokedSkills?: readonly string[]
): SkillMeta[] {
  const invoked = new Set((invokedSkills ?? []).map((s) => s.trim()).filter(Boolean));
  const visible = skills.filter((s) => {
    if (s.disableModelInvocation && !invoked.has(s.name)) return false;
    return true;
  });
  return visible.slice(0, MAX_CATALOGUE_SKILLS);
}

export async function listCatalogueSkills(
  workspacePath?: string,
  invokedSkills?: readonly string[]
): Promise<SkillMeta[]> {
  const all = await listSkills(workspacePath);
  return filterCatalogueVisibleSkills(all, invokedSkills);
}

export async function listCatalogueSkillNames(
  workspacePath?: string,
  invokedSkills?: readonly string[]
): Promise<string[]> {
  const visible = await listCatalogueSkills(workspacePath, invokedSkills);
  return visible.map((s) => s.name);
}

export async function findSkill(
  name: string,
  workspacePath?: string
): Promise<SkillMeta | undefined> {
  const skills = await listSkills(workspacePath);
  return skills.find((s) => s.name === name);
}

function clampBody(body: string, skillName: string): string {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes <= MAX_SKILL_BODY_BYTES) return body;
  log.warn('skill body truncated', { skillName, bytes, max: MAX_SKILL_BODY_BYTES });
  const buf = Buffer.from(body, 'utf8').subarray(0, MAX_SKILL_BODY_BYTES);
  return buf.toString('utf8').trimEnd() + '\n\n[truncated — skill body exceeded host limit]';
}

async function readFilesystemSkillBody(meta: SkillMeta): Promise<string> {
  const raw = await fs.readFile(meta.skillMdPath, 'utf8');
  const folderName = meta.name;
  const parsed = parseSkillFrontmatter(raw, folderName);
  const body = parsed?.body.trim() ?? raw.trim();
  return clampBody(body, meta.name);
}

export async function getSkillBody(name: string, workspacePath?: string): Promise<string | null> {
  const meta = await findSkill(name, workspacePath);
  if (!meta) return null;

  if (meta.source === 'bundled' || isBundledSkillName(name)) {
    const bundledName = name as BundledSkillName;
    if (!isBundledSkillName(bundledName)) {
      return null;
    }
    const override = await readSkillOverride(bundledName);
    if (override !== null && override.trim().length > 0) {
      const parsed = parseSkillFrontmatter(override, bundledName);
      const body = parsed?.body.trim() ?? override.trim();
      return clampBody(body, name);
    }
    return clampBody(getBundledSkillBody(bundledName), name);
  }

  try {
    return await readFilesystemSkillBody(meta);
  } catch (err) {
    log.warn('failed to read skill body', { name, err });
    return null;
  }
}

export async function readSkillFileContent(
  meta: SkillMeta
): Promise<{ raw: string; effective: string }> {
  if (meta.source === 'bundled' && isBundledSkillName(meta.name)) {
    const raw = readBundledSkillRaw(meta.name);
    const override = await readSkillOverride(meta.name);
    return { raw, effective: override ?? raw };
  }
  const raw = await fs.readFile(meta.skillMdPath, 'utf8');
  return { raw, effective: raw };
}

