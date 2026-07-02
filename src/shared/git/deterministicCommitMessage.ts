/**
 * Deterministic Conventional Commit messages for lockfile-only and binary-only stages.
 * Skips LLM when the staged set is entirely non-source artifacts.
 */

import { wrapCommitMessageBody } from './wrapCommitMessageBody.js';

const LOCKFILE_RE =
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum|bun\.lockb?|npm-shrinkwrap\.json)$/i;

const BINARY_EXT_RE =
  /\.(?:png|jpe?g|gif|webp|avif|ico|pdf|woff2?|ttf|eot|otf|mp[34]|wav|zip|tar|gz|7z|rar|dll|exe|so|dylib|bin|dmg|apk|ipa|wasm)$/i;

export type DeterministicCommitKind = 'lockfile-only' | 'binary-only' | 'lockfile-and-binary';

export function isLockfilePath(path: string): boolean {
  return LOCKFILE_RE.test(path);
}

export function isBinaryAssetPath(path: string): boolean {
  return BINARY_EXT_RE.test(path);
}

export function classifyDeterministicCommit(paths: string[]): DeterministicCommitKind | null {
  if (paths.length === 0) return null;

  let lockfiles = 0;
  let binaries = 0;
  for (const path of paths) {
    const lock = isLockfilePath(path);
    const binary = isBinaryAssetPath(path);
    if (!lock && !binary) return null;
    if (lock) lockfiles++;
    if (binary) binaries++;
  }

  if (lockfiles > 0 && binaries > 0) return 'lockfile-and-binary';
  if (lockfiles > 0) return 'lockfile-only';
  return 'binary-only';
}

function formatPathList(paths: string[], max = 6): string {
  const shown = paths.slice(0, max);
  const suffix = paths.length > max ? ` and ${paths.length - max} more` : '';
  return `${shown.join(', ')}${suffix}`;
}

function scopeFromPaths(paths: string[]): string | null {
  const dirs = new Set<string>();
  for (const p of paths) {
    const slash = p.indexOf('/');
    dirs.add(slash < 0 ? '.' : p.slice(0, slash));
  }
  if (dirs.size !== 1) return null;
  const dir = [...dirs][0]!;
  if (dir === '.') return null;
  return dir.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 48) || null;
}

export function buildDeterministicCommitMessage(
  kind: DeterministicCommitKind,
  paths: string[]
): string {
  const scope = scopeFromPaths(paths);
  const scopePart = scope ? `(${scope})` : '';

  if (kind === 'lockfile-only') {
    const listed = paths.filter(isLockfilePath);
    const subject = `chore${scopePart}: update lockfile${listed.length > 1 ? 's' : ''}`;
    const body =
      `Updates ${formatPathList(listed)} so dependency resolution stays reproducible ` +
      'across machines and CI. No application source files changed in this commit.';
    return wrapCommitMessageBody(`${subject}\n\n${body}`);
  }

  if (kind === 'binary-only') {
    const listed = paths.filter(isBinaryAssetPath);
    const subject = `chore${scopePart}: add binary assets`;
    const body =
      `Adds ${formatPathList(listed)}. These are non-text assets bundled with the project ` +
      'and do not alter runtime logic.';
    return wrapCommitMessageBody(`${subject}\n\n${body}`);
  }

  const lockListed = paths.filter(isLockfilePath);
  const binListed = paths.filter(isBinaryAssetPath);
  const subject = `chore${scopePart}: update lockfiles and add assets`;
  const body =
    `Refreshes ${formatPathList(lockListed)} and adds ${formatPathList(binListed)}. ` +
    'Lockfiles keep installs deterministic; binary assets ship required media without source changes.';
  return wrapCommitMessageBody(`${subject}\n\n${body}`);
}
