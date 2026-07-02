/**
 * Filesystem discovery for Agent Skills (SKILL.md).
 */

import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { WORKSPACE_DOTDIR } from '@shared/constants.js';
import type { SkillMeta, SkillSource } from '@shared/types/skills.js';
import { SKILL_FILENAME } from '@shared/types/skills.js';
import { globalSkillsDir } from '../paths/userDataLayout.js';
import { parseSkillFrontmatter, assertSkillNameMatchesFolder } from './parseSkillFrontmatter.js';
import { logger } from '../logging/logger.js';

const log = logger.child('skills/discovery');

const MAX_WALK_DEPTH = 12;
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'out', '.next', 'build', 'coverage']);

interface DiscoveredSkill {
  meta: SkillMeta;
  priority: number;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/');
}

async function readSkillFile(
  skillMdPath: string,
  source: SkillSource,
  priority: number,
  scopeHint?: string
): Promise<DiscoveredSkill | null> {
  try {
    const raw = await fs.readFile(skillMdPath, 'utf8');
    const folderName = basename(dirname(skillMdPath));
    const parsed = parseSkillFrontmatter(raw, folderName);
    if (!parsed) {
      log.debug('skipping SKILL.md with missing description', { skillMdPath });
      return null;
    }
    if (!assertSkillNameMatchesFolder(parsed.name, folderName)) {
      log.warn('skill name does not match parent folder; using folder name', {
        skillMdPath,
        frontmatterName: parsed.name,
        folderName
      });
      parsed.name = folderName;
    }
    const rootPath = dirname(skillMdPath);
    return {
      priority,
      meta: {
        name: parsed.name,
        description: parsed.description,
        source,
        rootPath,
        skillMdPath,
        ...(parsed.paths?.length ? { paths: parsed.paths } : {}),
        ...(parsed.disableModelInvocation ? { disableModelInvocation: true } : {}),
        ...(scopeHint ? { scopeHint } : {})
      }
    };
  } catch (err) {
    log.debug('failed to read SKILL.md', { skillMdPath, err });
    return null;
  }
}

async function walkSkillsRoot(
  rootDir: string,
  source: SkillSource,
  priority: number,
  scopeHint?: string,
  depth = 0
): Promise<DiscoveredSkill[]> {
  if (depth > MAX_WALK_DEPTH || !existsSync(rootDir)) return [];
  const found: DiscoveredSkill[] = [];

  async function walk(dir: string, d: number): Promise<void> {
    if (d > MAX_WALK_DEPTH) return;
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.isFile() && entry === SKILL_FILENAME) {
        const row = await readSkillFile(full, source, priority, scopeHint);
        if (row) found.push(row);
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (SKIP_DIR_NAMES.has(entry)) continue;
      await walk(full, d + 1);
    }
  }

  await walk(rootDir, depth);
  return found;
}

function shouldEnterVyotiqChild(entryName: string): boolean {
  return entryName === 'skills';
}

async function walkWorkspaceForNestedSkills(
  workspacePath: string,
  source: SkillSource,
  basePriority: number
): Promise<DiscoveredSkill[]> {
  const found: DiscoveredSkill[] = [];

  async function walk(dir: string, depth: number, insideVyotiq: boolean): Promise<void> {
    if (depth > MAX_WALK_DEPTH) return;
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }

      if (stat.isFile() && entry === SKILL_FILENAME) {
        const rel = normalizeRel(relative(workspacePath, dirname(full)));
        const scopeHint = rel.includes('/') ? rel.split('/skills/')[0] : undefined;
        const row = await readSkillFile(full, source, basePriority, scopeHint);
        if (row) found.push(row);
        continue;
      }

      if (!stat.isDirectory()) continue;
      if (SKIP_DIR_NAMES.has(entry)) continue;

      if (entry === WORKSPACE_DOTDIR) {
        const skillsRoot = join(full, 'skills');
        if (existsSync(skillsRoot)) {
          const nested = await walkSkillsRoot(
            skillsRoot,
            'workspace',
            basePriority + 1,
            normalizeRel(relative(workspacePath, skillsRoot))
          );
          found.push(...nested);
        }
        continue;
      }

      if (entry === '.cursor' || entry === '.agents') {
        const skillsRoot = join(full, 'skills');
        if (existsSync(skillsRoot)) {
          const nested = await walkSkillsRoot(
            skillsRoot,
            'cursor-project',
            basePriority + 2,
            normalizeRel(relative(workspacePath, dirname(skillsRoot)))
          );
          found.push(...nested);
        }
        continue;
      }

      if (insideVyotiq && !shouldEnterVyotiqChild(entry)) continue;
      await walk(full, depth + 1, entry === WORKSPACE_DOTDIR || insideVyotiq);
    }
  }

  await walk(workspacePath, 0, false);
  return found;
}

export interface DiscoverSkillsOpts {
  workspacePath?: string;
}

/**
 * Discover skills from all configured roots. Returns merged list with
 * collision resolution applied (higher priority wins per skill name).
 */
export async function discoverSkillsFromDisk(opts: DiscoverSkillsOpts): Promise<SkillMeta[]> {
  const collected: DiscoveredSkill[] = [];
  const workspacePath = opts.workspacePath?.trim();

  if (workspacePath && existsSync(workspacePath)) {
    const wsVyotiqSkills = join(workspacePath, WORKSPACE_DOTDIR, 'skills');
    if (existsSync(wsVyotiqSkills)) {
      collected.push(
        ...(await walkSkillsRoot(wsVyotiqSkills, 'workspace', 70, workspacePath))
      );
    }
    const wsCursor = join(workspacePath, '.cursor', 'skills');
    if (existsSync(wsCursor)) {
      collected.push(...(await walkSkillsRoot(wsCursor, 'cursor-project', 40, workspacePath)));
    }
    const wsAgents = join(workspacePath, '.agents', 'skills');
    if (existsSync(wsAgents)) {
      collected.push(...(await walkSkillsRoot(wsAgents, 'cursor-project', 40, workspacePath)));
    }
    collected.push(...(await walkWorkspaceForNestedSkills(workspacePath, 'workspace', 60)));
  }

  const globalDir = globalSkillsDir();
  if (existsSync(globalDir)) {
    collected.push(...(await walkSkillsRoot(globalDir, 'global', 30)));
  }

  const home = homedir();
  const homeCursor = join(home, '.cursor', 'skills');
  if (existsSync(homeCursor)) {
    collected.push(...(await walkSkillsRoot(homeCursor, 'cursor-global', 20)));
  }
  const homeAgents = join(home, '.agents', 'skills');
  if (existsSync(homeAgents)) {
    collected.push(...(await walkSkillsRoot(homeAgents, 'cursor-global', 20)));
  }

  const byName = new Map<string, DiscoveredSkill>();
  for (const row of collected) {
    const existing = byName.get(row.meta.name);
    if (!existing || row.priority > existing.priority) {
      byName.set(row.meta.name, row);
    }
  }

  return [...byName.values()]
    .map((r) => r.meta)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isSkillRelatedPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/');
  if (norm.endsWith(`/${SKILL_FILENAME}`) || norm === SKILL_FILENAME) return true;
  if (norm.includes('/skills/')) return true;
  if (norm.includes('/.cursor/skills/')) return true;
  if (norm.includes('/.agents/skills/')) return true;
  return false;
}
