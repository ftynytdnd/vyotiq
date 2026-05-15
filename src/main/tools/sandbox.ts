/**
 * Workspace path containment guard. EVERY tool that accepts a path must run
 * it through `resolveInsideWorkspace` before touching the filesystem. This is
 * the choke-point that enforces the "Containment" prime directive.
 */

import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import { promises as fs } from 'node:fs';

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

/**
 * Resolves a user/agent-supplied path against the workspace root and verifies
 * the result stays inside it. Returns the absolute path on success, throws
 * SandboxError otherwise.
 *
 * - Relative paths are resolved against `workspaceRoot`.
 * - Absolute paths must already lie inside `workspaceRoot`.
 * - Symlinks are NOT followed at this layer; tools that read content rely on
 *   the OS for the final check.
 */
export function resolveInsideWorkspace(workspaceRoot: string, p: string): string {
  if (!workspaceRoot) {
    throw new SandboxError('No workspace root configured.');
  }
  const root = resolve(workspaceRoot);
  const candidate = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || (isAbsolute(rel) && rel !== '')) {
    throw new SandboxError(
      `Path "${p}" escapes the workspace sandbox (resolved to ${candidate}).`
    );
  }
  return candidate;
}

/** True if `p` already resolves inside `workspaceRoot`. Does not throw. */
export function isInsideWorkspace(workspaceRoot: string, p: string): boolean {
  try {
    resolveInsideWorkspace(workspaceRoot, p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lexical containment passes (`resolveInsideWorkspace`) PLUS a real-path
 * check that follows symlinks. This is the safer gate for tools that read
 * EXISTING files: a symlink whose target lives outside the workspace will
 * be rejected here even though the lexical resolution stayed inside.
 *
 * For paths that don't yet exist (e.g. `edit { create: true }` to a new
 * file), `realpath` would throw ENOENT — we fall back to the lexical
 * resolution in that case so creation flows still work. NOTE: this
 * fallback is UNSAFE for the creation path because it doesn't validate
 * the deepest existing ANCESTOR — if a mid-path segment is a symlink
 * pointing outside the workspace, create would happily write through
 * it. Creation callers must use `resolveCreateInsideWorkspace` instead.
 */
export async function realpathInsideWorkspace(
  workspaceRoot: string,
  p: string
): Promise<string> {
  const lex = resolveInsideWorkspace(workspaceRoot, p);
  const realRoot = await realpathWorkspaceRoot(workspaceRoot);
  let real: string;
  try {
    real = await fs.realpath(lex);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return lex;
    throw err;
  }
  const rel = relative(realRoot, real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new SandboxError(
      `Path "${p}" symlinks outside the workspace (resolved to ${real}).`
    );
  }
  return real;
}

/**
 * Resolve a path intended for a NEW file (`edit { create: true }`) so
 * that no symlinked ancestor can redirect the write outside the
 * workspace. Strategy:
 *
 *   1. Lexically resolve + verify containment (same as
 *      `resolveInsideWorkspace`).
 *   2. Walk UPWARDS from the target until we find an existing directory
 *      on disk.
 *   3. Real-path that ancestor and assert it still lies inside the
 *      real-path'd workspace root.
 *   4. Re-append the non-existent suffix to the canonicalised ancestor.
 *
 * Without this, a workspace containing a pre-existing symlink
 * `vendor → /etc` would allow a rogue (or merely confused) agent to
 * `edit { create: true, path: 'vendor/passwd', content: '…' }` and
 * write through the symlink — a direct violation of the "Containment"
 * Prime Directive.
 */
export async function resolveCreateInsideWorkspace(
  workspaceRoot: string,
  p: string
): Promise<string> {
  const lex = resolveInsideWorkspace(workspaceRoot, p);
  const realRoot = await realpathWorkspaceRoot(workspaceRoot);

  // Walk from the target upwards. The loop always terminates because
  // `dirname('/')` and `dirname('C:\\')` return themselves — we stop
  // the instant we find an `fs.realpath` hit.
  let probe = lex;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const realAncestor = await fs.realpath(probe);
      const rel = relative(realRoot, realAncestor);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new SandboxError(
          `Path "${p}" has a symlinked ancestor that escapes the workspace ` +
          `(ancestor "${probe}" resolves to "${realAncestor}").`
        );
      }
      // Compose the canonicalised ancestor with any non-existent tail
      // segments that were skipped over during the walk. `missingSegments`
      // is populated child-first, so reverse before re-appending.
      if (missingSegments.length === 0) return realAncestor;
      return [realAncestor, ...missingSegments.reverse()].join(sep);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      const parent = dirname(probe);
      if (parent === probe) {
        // Walked past the filesystem root without hitting an existing
        // ancestor — something is very wrong with the workspace path.
        // Fall back to the lexical result after defense-in-depth check.
        return lex;
      }
      missingSegments.push(probe.slice(parent.length + 1));
      probe = parent;
    }
  }
}

async function realpathWorkspaceRoot(workspaceRoot: string): Promise<string> {
  // Fail CLOSED when we can't canonicalize the workspace root. Using the
  // lexical `resolve(workspaceRoot)` as a fallback is unsafe: if a parent
  // directory of the workspace itself is a symlink into another tree,
  // the subsequent `relative(lexicalRoot, realFile)` comparison can
  // pass for a file that genuinely lives outside the workspace.
  // Containment is the Prime Directive — better to reject the call than
  // to silently weaken the guard.
  try {
    return await fs.realpath(workspaceRoot);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SandboxError(
      `Cannot canonicalize workspace root "${workspaceRoot}": ${msg}. ` +
      'Refusing path access until the workspace is reachable.'
    );
  }
}

/** Display-friendly relative path within the workspace. */
export function workspaceRelative(workspaceRoot: string, abs: string): string {
  const rel = relative(workspaceRoot, abs);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

/**
 * Patterns that look catastrophically destructive and require explicit
 * confirmation before executing — even with `allowBash: true`.
 */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
  // Absolute-rooted recursive remove (`rm -rf /...`). The previous
  // form carried a `(?!\S*workspace)` negative lookahead intended to
  // exempt paths under a folder literally named "workspace" — but
  // the bash tool always runs with `cwd` pinned to the workspace
  // root, so an absolute `rm -rf /...` ALWAYS escapes the sandbox
  // regardless of whether the workspace folder happens to share the
  // "workspace" substring with the target path. The lookahead was
  // also workspace-name-dependent (a user whose workspace was at
  // `~/my-workspace` had this guard silently disabled). Review
  // finding H4 — dropped the lookahead so any `/`-rooted recursive
  // remove requires explicit confirmation.
  /\brm\s+-[a-z]*r[a-z]*f?\s+\//i,
  // Workspace-root wipe variants. The bash tool spawns with `cwd` set to
  // the workspace root, so these resolve INSIDE the sandbox — the
  // absolute-path regex above never fires. Without this line a sub-agent
  // running with default permissions (`allowBash + allowFileWrites`) can
  // destroy the user's entire working tree in one call.
  //
  // Pattern breakdown (alternatives):
  //   `\.(?:\/\S*|(?=\s|$))`   → `.`, `./`, `./src`, `./node_modules/...`
  //   `\.{2}(?:\/\S*|(?=\s|$))` → `..`, `../src`, ...
  //   `\*`                     → `rm -rf *`
  //   `\.\[`                   → dotfile glob `.[^.]*`
  //
  // The `(?=\s|$)` lookahead on the bare-dot forms is deliberate: it
  // catches `rm -rf .` while still letting `rm -rf .foo` (a specific
  // dotfile) fall through unflagged — scoped destruction of a named
  // file is not a "wipe the workspace" pattern.
  /\brm\s+-[a-z]*r[a-z]*f?\s+(?:\.(?:\/\S*|(?=\s|$))|\.{2}(?:\/\S*|(?=\s|$))|\*|\.\[)/i,
  // `find … -delete` / `find … -exec rm …` rooted at the workspace.
  /\bfind\s+\S+.*-(?:delete|exec\s+rm)\b/i,
  /\brimraf\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  // Any PowerShell `Remove-Item -Recurse` is treated as destructive,
  // regardless of target. The previous regex only fired when a drive
  // letter was present, so `Remove-Item -Recurse -Force ./vendor` slipped
  // through. We also recognize the `rd`, `rmdir`, and `ri` aliases.
  // NOTE: `-Recurse` cannot use a leading `\b` — the hyphen is a
  // non-word character, so `\b` would require a word→non-word
  // transition that never exists when the flag is preceded by
  // whitespace. We anchor on the trailing word boundary only.
  /\bRemove-Item\b[^|]*-Recurse\b/i,
  /\b(?:rd|rmdir|ri)\b[^|]*-Recurse\b/i,
  // PowerShell pipeline variants that sidestep the `-Recurse` flag:
  //   `Get-ChildItem -Recurse | Remove-Item -Force`
  //   `gci -R | ri -Force`
  // The enumerator does the recursion; `Remove-Item` then deletes each
  // item individually, leaving no single `-Recurse` to match.
  /\b(?:Get-ChildItem|gci|ls)\b[^|]*\|[^|]*\b(?:Remove-Item|ri|rm|del)\b/i,
  /\bmkfs\b/i,
  /\bdd\b\s+if=.*of=\/dev\//i,
  /\bgit\s+(reset\s+--hard|clean\s+-fdx|push\s+--force|branch\s+-D|reflog\s+expire)/i,
  /:\(\)\s*\{\s*:\|:&\s*\}/, // fork bomb
  /shutdown\b|reboot\b/i,
  /\bDel\b\s+\/[fqsr]+\s+[A-Z]:\\/i
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(command));
}
