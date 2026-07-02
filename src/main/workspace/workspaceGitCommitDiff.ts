/**
 * Build a diff excerpt and structured change analysis for AI commit message generation.
 */

import { normalizePorcelainPath } from './workspaceGitStatus.js';
import { readWorkspaceTextFileCapped } from './workspaceGitFileDiff.js';
import type { WorkspaceGitRun } from './workspaceGitRunner.js';

const MAX_UNTRACKED_FILES = 24;
const MAX_UNTRACKED_FILE_CHARS = 2_000;
export const MAX_DIFF_CHARS = 14_000;
const MAX_PRIORITY_DIFFS = 10;
const MAX_LISTED_PATHS = 64;
const MAX_PER_FILE_DIFF_CHARS = 1_200;
const MAX_MAP_REDUCE_FILES = 40;
const HISTORY_SAMPLE_COUNT = 15;

/** File count at which map-reduce per-file summarization kicks in. */
export const MAP_REDUCE_FILE_THRESHOLD = 25;

export interface CommitRelevantPaths {
  paths: string[];
  staged: boolean;
}

export interface PerFileDiffBlock {
  path: string;
  excerpt: string;
}

export interface CommitDiffContext {
  excerpt: string;
  fullDiffChars: number;
  truncated: boolean;
  oversized: boolean;
  totalPaths: number;
  mapReduceRequired: boolean;
  perFileBlocks: PerFileDiffBlock[];
}

const PRIORITY_PATH_RE =
  /(?:^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|go\.mod|pyproject\.toml|README(?:\.\w+)?|CHANGELOG(?:\.\w+)?|tsconfig(?:\.\w+)?\.json|vite\.config\.\w+|next\.config\.\w+|eslint\.config\.\w+)$/i;

const SOURCE_EXT_RE = /\.(tsx?|jsx?|py|rs|go|vue|svelte|css|scss|html|md)$/i;

export interface CommitChangeAnalysis {
  totalFiles: number;
  stagedCount: number;
  unstagedCount: number;
  byStatus: Record<string, number>;
  topDirs: Array<{ dir: string; count: number }>;
  extensions: Array<{ ext: string; count: number }>;
  keyFiles: string[];
  allAdded: boolean;
  likelyInitialImport: boolean;
  primaryScope: string | null;
  summary: string;
}

interface PorcelainEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
}

function parsePorcelain(porcelain: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const indexStatus = line[0] ?? ' ';
    const worktreeStatus = line[1] ?? ' ';
    const path = normalizePorcelainPath(line.slice(3));
    if (!path) continue;
    const staged = indexStatus !== ' ' && indexStatus !== '?';
    entries.push({ path, indexStatus, worktreeStatus, staged });
  }
  return entries;
}

function fileExtension(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '(no ext)';
  return base.slice(dot + 1).toLowerCase();
}

function topLevelDir(path: string): string {
  const slash = path.indexOf('/');
  return slash < 0 ? '.' : path.slice(0, slash);
}

function inferPrimaryScope(entries: PorcelainEntry[]): string | null {
  const dirCounts = new Map<string, number>();
  for (const e of entries) {
    const dir = topLevelDir(e.path);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  if (dirCounts.size === 0) return null;
  const sorted = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  const [topDir, topCount] = sorted[0]!;
  if (topDir === '.' || topCount < entries.length * 0.55) return null;
  return topDir.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48) || null;
}

function formatAnalysis(entries: PorcelainEntry[]): CommitChangeAnalysis {
  const byStatus: Record<string, number> = {};
  const dirCounts = new Map<string, number>();
  const extCounts = new Map<string, number>();
  const keyFiles: string[] = [];
  let stagedCount = 0;
  let addedCount = 0;

  for (const e of entries) {
    const status = e.indexStatus !== ' ' ? e.indexStatus : e.worktreeStatus;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (e.staged) stagedCount++;
    if (status === 'A' || status === '?') addedCount++;

    const dir = topLevelDir(e.path);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);

    const ext = fileExtension(e.path);
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);

    if (PRIORITY_PATH_RE.test(e.path) && keyFiles.length < 12) {
      keyFiles.push(e.path);
    }
  }

  const topDirs = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([dir, count]) => ({ dir, count }));

  const extensions = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ext, count]) => ({ ext, count }));

  const allAdded = entries.length > 0 && addedCount === entries.length;
  const likelyInitialImport = allAdded && entries.length >= 8;
  const primaryScope = inferPrimaryScope(entries);
  const unstagedCount = entries.length - stagedCount;

  const lines: string[] = [
    `Total changed paths: ${entries.length}`,
    `Staged: ${stagedCount}, unstaged/untracked: ${unstagedCount}`,
    `Status breakdown: ${Object.entries(byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
    `Top directories: ${topDirs.map((d) => `${d.dir} (${d.count})`).join(', ')}`,
    `File types: ${extensions.map((e) => `.${e.ext} (${e.count})`).join(', ')}`
  ];
  if (keyFiles.length > 0) {
    lines.push(`Notable files: ${keyFiles.join(', ')}`);
  }
  if (likelyInitialImport && primaryScope) {
    lines.push(`Pattern: initial import/scaffold under "${primaryScope}" (${entries.length} new files)`);
  }
  if (primaryScope) {
    lines.push(`Suggested scope: ${primaryScope}`);
  }

  return {
    totalFiles: entries.length,
    stagedCount,
    unstagedCount,
    byStatus,
    topDirs,
    extensions,
    keyFiles,
    allAdded,
    likelyInitialImport,
    primaryScope,
    summary: lines.join('\n')
  };
}

export async function buildCommitChangeAnalysis(gitRun: WorkspaceGitRun): Promise<CommitChangeAnalysis | null> {
  try {
    const porcelain = (await gitRun(['status', '--porcelain', '-u'])).trim();
    if (!porcelain) return null;
    const entries = parsePorcelain(porcelain);
    if (entries.length === 0) return null;
    return formatAnalysis(entries);
  } catch {
    return null;
  }
}

async function readGitDiff(gitRun: WorkspaceGitRun, args: string[]): Promise<string> {
  try {
    return (await gitRun(args)).trim();
  } catch {
    return '';
  }
}

function rankPathForDiff(path: string): number {
  if (PRIORITY_PATH_RE.test(path)) return 0;
  if (SOURCE_EXT_RE.test(path)) return 1;
  return 2;
}

function selectPriorityPaths(entries: PorcelainEntry[]): string[] {
  const paths = [...new Set(entries.map((e) => e.path))];
  paths.sort((a, b) => {
    const ra = rankPathForDiff(a);
    const rb = rankPathForDiff(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return paths.slice(0, MAX_PRIORITY_DIFFS);
}

async function buildPriorityDiffs(
  gitRun: WorkspaceGitRun,
  paths: string[],
  staged: boolean
): Promise<string> {
  const blocks: string[] = [];
  for (const path of paths) {
    const args = staged
      ? ['diff', '--cached', '--', path]
      : ['diff', '--', path];
    const diff = await readGitDiff(gitRun, args);
    if (diff) blocks.push(diff);
  }
  return blocks.join('\n\n');
}

async function buildUntrackedExcerpt(
  wsPath: string,
  gitRun: WorkspaceGitRun,
  entries?: PorcelainEntry[]
): Promise<string> {
  let porcelainEntries = entries;
  if (!porcelainEntries) {
    try {
      const porcelain = await gitRun(['status', '--porcelain', '-u']);
      porcelainEntries = parsePorcelain(porcelain);
    } catch {
      return '';
    }
  }

  const untracked = porcelainEntries.filter(
    (e) => e.indexStatus === '?' && e.worktreeStatus === '?'
  );
  const blocks: string[] = [];
  const priority = selectPriorityPaths(untracked);

  for (const path of priority) {
    const read = await readWorkspaceTextFileCapped(wsPath, path);
    if (read && !read.binary && read.text.trim()) {
      const body =
        read.text.length > MAX_UNTRACKED_FILE_CHARS
          ? `${read.text.slice(0, MAX_UNTRACKED_FILE_CHARS)}\n… (truncated)`
          : read.text;
      blocks.push(`--- /dev/null\n+++ b/${path}\n${body}`);
    } else {
      blocks.push(`new file: ${path}`);
    }
    if (blocks.length >= MAX_UNTRACKED_FILES) break;
  }

  const listed = untracked.map((e) => e.path);
  if (listed.length > blocks.length) {
    const rest = listed.slice(blocks.length, blocks.length + MAX_LISTED_PATHS);
    blocks.push(`Other untracked (${listed.length - blocks.length}):\n${rest.join('\n')}`);
  }

  return blocks.join('\n\n');
}

function capDiff(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DIFF_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)`,
    truncated: true
  };
}

async function loadPorcelainEntries(gitRun: WorkspaceGitRun): Promise<PorcelainEntry[]> {
  try {
    const porcelain = await gitRun(['status', '--porcelain', '-u']);
    return porcelain ? parsePorcelain(porcelain) : [];
  } catch {
    return [];
  }
}

/** Paths included in the commit message context (staged when present, else all changes). */
export async function listCommitRelevantPaths(
  gitRun: WorkspaceGitRun
): Promise<CommitRelevantPaths | null> {
  const entries = await loadPorcelainEntries(gitRun);
  if (entries.length === 0) return null;

  const stagedDiff = await readGitDiff(gitRun, ['diff', '--cached']);
  const useStaged = Boolean(stagedDiff) || entries.some((e) => e.staged);
  const relevant = useStaged
    ? entries.filter((e) => e.staged || e.indexStatus === 'A')
    : entries;

  const paths = [...new Set(relevant.map((e) => e.path))];
  if (paths.length === 0) return null;
  return { paths, staged: useStaged };
}

function selectMapReducePaths(entries: PorcelainEntry[]): string[] {
  const paths = [...new Set(entries.map((e) => e.path))];
  paths.sort((a, b) => {
    const ra = rankPathForDiff(a);
    const rb = rankPathForDiff(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return paths.slice(0, MAX_MAP_REDUCE_FILES);
}

async function buildPerFileDiffBlock(
  gitRun: WorkspaceGitRun,
  wsPath: string,
  path: string,
  staged: boolean,
  entry?: PorcelainEntry
): Promise<PerFileDiffBlock | null> {
  if (entry?.indexStatus === '?' && entry.worktreeStatus === '?') {
    const read = await readWorkspaceTextFileCapped(wsPath, path);
    if (read && !read.binary && read.text.trim()) {
      const body =
        read.text.length > MAX_PER_FILE_DIFF_CHARS
          ? `${read.text.slice(0, MAX_PER_FILE_DIFF_CHARS)}\n…`
          : read.text;
      return { path, excerpt: `new file\n${body}` };
    }
    return { path, excerpt: 'new untracked file' };
  }

  const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path];
  const diff = await readGitDiff(gitRun, args);
  if (!diff) return { path, excerpt: '(no diff text)' };
  const capped =
    diff.length > MAX_PER_FILE_DIFF_CHARS
      ? `${diff.slice(0, MAX_PER_FILE_DIFF_CHARS)}\n…`
      : diff;
  return { path, excerpt: capped };
}

/** Per-file diff excerpts for map-reduce summarization on large commits. */
export async function buildPerFileDiffBlocks(
  gitRun: WorkspaceGitRun,
  wsPath: string,
  paths: string[],
  staged: boolean,
  entries: PorcelainEntry[]
): Promise<PerFileDiffBlock[]> {
  const entryByPath = new Map(entries.map((e) => [e.path, e]));
  const blocks: PerFileDiffBlock[] = [];
  for (const path of paths) {
    const block = await buildPerFileDiffBlock(
      gitRun,
      wsPath,
      path,
      staged,
      entryByPath.get(path)
    );
    if (block) blocks.push(block);
  }
  return blocks;
}

/** Recent commit subjects/bodies so generated messages match repository style. */
export async function buildCommitHistorySamples(gitRun: WorkspaceGitRun): Promise<string> {
  try {
    return (
      await gitRun([
        'log',
        `-${HISTORY_SAMPLE_COUNT}`,
        '--format=%s%n%b%n---'
      ])
    ).trim();
  } catch {
    return '';
  }
}

async function assembleDiffExcerpt(
  gitRun: WorkspaceGitRun,
  wsPath: string,
  entries: PorcelainEntry[]
): Promise<{ excerpt: string; fullDiffChars: number; truncated: boolean }> {
  const stagedStat = await readGitDiff(gitRun, ['diff', '--cached', '--stat']);
  const unstagedStat = await readGitDiff(gitRun, ['diff', '--stat']);
  const stagedDiff = await readGitDiff(gitRun, ['diff', '--cached']);
  const unstagedDiff = await readGitDiff(gitRun, ['diff']);

  const parts: string[] = [];

  if (stagedStat) parts.push(`Staged diff stat:\n${stagedStat}`);
  else if (unstagedStat) parts.push(`Unstaged diff stat:\n${unstagedStat}`);

  const primaryDiff = stagedDiff || unstagedDiff;
  const fullDiffChars = primaryDiff.length;
  const useStaged = Boolean(stagedDiff);
  const relevantEntries = entries.filter((e) =>
    useStaged ? e.staged || e.indexStatus === 'A' : true
  );

  let truncated = false;

  if (primaryDiff && primaryDiff.length <= MAX_DIFF_CHARS) {
    parts.push(primaryDiff);
  } else if (primaryDiff) {
    const priorityPaths = selectPriorityPaths(relevantEntries.length ? relevantEntries : entries);
    const priorityDiff = await buildPriorityDiffs(gitRun, priorityPaths, useStaged);
    if (priorityDiff) {
      parts.push(
        `Priority file diffs (${priorityPaths.length} of ${entries.length} paths):\n\n${priorityDiff}`
      );
    }
    const sample = primaryDiff.slice(0, Math.min(6_000, MAX_DIFF_CHARS));
    parts.push(`Diff excerpt:\n${sample}\n… (full diff truncated)`);
    truncated = true;
  } else {
    const untracked = await buildUntrackedExcerpt(wsPath, gitRun, entries);
    if (untracked) parts.push(untracked);
  }

  const joined = parts.filter(Boolean).join('\n\n');
  const capped = capDiff(joined);
  return { excerpt: capped.text, fullDiffChars, truncated: truncated || capped.truncated };
}

export async function buildCommitDiffContext(
  gitRun: WorkspaceGitRun,
  wsPath: string
): Promise<CommitDiffContext | null> {
  const entries = await loadPorcelainEntries(gitRun);
  if (entries.length === 0) return null;

  const { excerpt, fullDiffChars, truncated } = await assembleDiffExcerpt(gitRun, wsPath, entries);
  const relevant = await listCommitRelevantPaths(gitRun);
  const totalPaths = relevant?.paths.length ?? entries.length;
  const mapReduceRequired = totalPaths >= MAP_REDUCE_FILE_THRESHOLD;
  const oversized =
    truncated && (fullDiffChars > MAX_DIFF_CHARS || totalPaths >= MAP_REDUCE_FILE_THRESHOLD);

  let perFileBlocks: PerFileDiffBlock[] = [];
  if (mapReduceRequired && relevant) {
    const mapPaths = selectMapReducePaths(
      entries.filter((e) => relevant.paths.includes(e.path))
    );
    perFileBlocks = await buildPerFileDiffBlocks(
      gitRun,
      wsPath,
      mapPaths,
      relevant.staged,
      entries
    );
  }

  return {
    excerpt,
    fullDiffChars,
    truncated,
    oversized,
    totalPaths,
    mapReduceRequired,
    perFileBlocks
  };
}

/** Short porcelain summary for AI commit message context. */
export async function buildCommitChangeSummary(gitRun: WorkspaceGitRun): Promise<string> {
  const analysis = await buildCommitChangeAnalysis(gitRun);
  if (!analysis) return '';
  const paths = await readGitDiff(gitRun, ['status', '--porcelain', '-u']);
  const entries = parsePorcelain(paths);
  const capped = entries.slice(0, 48).map((e) => {
    const status = e.indexStatus !== ' ' ? e.indexStatus : e.worktreeStatus;
    return `${status} ${e.path}`;
  });
  const suffix =
    entries.length > capped.length ? `\n… and ${entries.length - capped.length} more paths` : '';
  return `${analysis.summary}\n\nPaths:\n${capped.join('\n')}${suffix}`;
}

export async function buildCommitDiffExcerpt(
  gitRun: WorkspaceGitRun,
  wsPath: string
): Promise<string> {
  const ctx = await buildCommitDiffContext(gitRun, wsPath);
  return ctx?.excerpt ?? '';
}

function findPackageJsonPath(entries: PorcelainEntry[], scope: string | null): string | null {
  const candidates = entries
    .map((e) => e.path)
    .filter((p) => /(?:^|\/)package\.json$/i.test(p));
  if (candidates.length === 0) return null;
  if (scope) {
    const scoped = candidates.find((p) => p.startsWith(`${scope}/`) || p === 'package.json');
    if (scoped) return scoped;
  }
  return candidates[0] ?? null;
}

function findReadmePath(entries: PorcelainEntry[], scope: string | null): string | null {
  const candidates = entries
    .map((e) => e.path)
    .filter((p) => /(?:^|\/)README(?:\.\w+)?$/i.test(p));
  if (candidates.length === 0) return null;
  if (scope) {
    const scoped = candidates.find((p) => p.startsWith(`${scope}/`));
    if (scoped) return scoped;
  }
  return candidates[0] ?? null;
}

/** Read package.json / README snippets so the model can describe the project in plain language. */
export async function buildCommitProjectHints(
  wsPath: string,
  gitRun: WorkspaceGitRun,
  analysis: CommitChangeAnalysis | null
): Promise<string> {
  if (!analysis) return '';
  let porcelain = '';
  try {
    porcelain = await gitRun(['status', '--porcelain', '-u']);
  } catch {
    return '';
  }
  const entries = parsePorcelain(porcelain);
  if (entries.length === 0) return '';

  const scope = analysis.primaryScope;
  const hints: string[] = [];

  const pkgPath = findPackageJsonPath(entries, scope);
  if (pkgPath) {
    const read = await readWorkspaceTextFileCapped(wsPath, pkgPath);
    if (read && !read.binary) {
      try {
        const pkg = JSON.parse(read.text) as {
          name?: string;
          description?: string;
          dependencies?: Record<string, unknown>;
        };
        if (pkg.name) hints.push(`package name: ${pkg.name}`);
        if (pkg.description?.trim()) hints.push(`package description: ${pkg.description.trim()}`);
        const deps = Object.keys(pkg.dependencies ?? {});
        const notable = deps.filter((d) =>
          /^(next|react|vue|drizzle|prisma|express|fastify|electron)/i.test(d)
        );
        if (notable.length > 0) hints.push(`notable dependencies: ${notable.slice(0, 8).join(', ')}`);
      } catch {
        // ignore invalid package.json
      }
    }
  }

  const readmePath = findReadmePath(entries, scope);
  if (readmePath) {
    const read = await readWorkspaceTextFileCapped(wsPath, readmePath);
    if (read && !read.binary && read.text.trim()) {
      const excerpt = read.text.trim().slice(0, 600).replace(/\n{3,}/g, '\n\n');
      hints.push(`README excerpt (${readmePath}):\n${excerpt}`);
    }
  }

  return hints.length > 0 ? hints.join('\n') : '';
}
