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

/**
 * Walk the workspace tree and return workspace-relative paths of symlinks
 * whose target resolves outside the real workspace root. Used to block bash
 * before the shell can follow escape links at runtime.
 */
export async function findSymlinksEscapingWorkspace(
  workspaceRoot: string,
  opts?: { maxHits?: number }
): Promise<string[]> {
  const maxHits = opts?.maxHits ?? 8;
  const escapes: string[] = [];
  const realRoot = await realpathWorkspaceRoot(workspaceRoot);
  const stack: string[] = [workspaceRoot];

  while (stack.length > 0 && escapes.length < maxHits) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const de of entries) {
      if (de.name === '.git' || de.name === 'node_modules') continue;
      const abs = resolve(dir, de.name);
      if (de.isSymbolicLink()) {
        try {
          const target = await fs.realpath(abs);
          const rel = relative(realRoot, target);
          if (rel.startsWith('..') || isAbsolute(rel)) {
            escapes.push(workspaceRelative(workspaceRoot, abs));
          }
        } catch {
          /* dangling symlink — shell may still fail closed */
        }
        continue;
      }
      if (de.isDirectory()) stack.push(abs);
    }
  }
  return escapes;
}

/** Display-friendly relative path within the workspace. */
export function workspaceRelative(workspaceRoot: string, abs: string): string {
  const rel = relative(workspaceRoot, abs);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

/**
 * Patterns that look catastrophically destructive. Matched `bash` commands
 * are blocked in-tool (see `isDestructiveCommand`) — no approval modal.
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
  // absolute-path regex above never fires. Without this line a tool call
  // running unchecked can destroy the user's entire working
  // tree in one call.
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
  /\brmdir\s+\/s\s+\/q\b/i,
  /\bdel\s+\/q\s+\/f\s+\/s\b/i,
  /\bFormat-Volume\b/i,
  /\bClear-Disk\b/i,
  /\bReset-Service\b/i,
  // PowerShell pipeline variants that sidestep the `-Recurse` flag:
  //   `Get-ChildItem -Recurse | Remove-Item -Force`
  //   `gci -R | ri -Force`
  // The enumerator does the recursion; `Remove-Item` then deletes each
  // item individually, leaving no single `-Recurse` to match.
  /\b(?:Get-ChildItem|gci|ls)\b[^|]*\|[^|]*\b(?:Remove-Item|ri|rm|del)\b/i,
  /\bmkfs\b/i,
  /\bdd\b\s+if=.*of=\/dev\//i,
  /\bgit\s+(reset\s+--hard|clean\s+-fdx|push\s+(?:--force|-f)\b|branch\s+-D|reflog\s+expire)/i,
  /:\(\)\s*\{\s*:\|:&\s*\}/, // fork bomb
  /shutdown\b|reboot\b/i,
  /\bDel\b\s+\/[fqsr]+\s+[A-Z]:\\/i,
  // Audit fix 2026-12-P2-2: out-of-workspace write redirection. The
  // bash tool spawns with cwd pinned to the workspace, but `>` /
  // `>>` redirections to ABSOLUTE paths bypass that lexical sandbox
  // and can land on `/etc/hosts`, `/var/log/*`, or `C:\Windows\…`.
  // The harness's "Containment" Prime Directive expects bash to be
  // workspace-bounded; this closes the gap.
  //
  // Negative-lookahead: `/tmp/…` and `/dev/null` are common and
  // benign (logs, fire-and-forget output) so we let them through.
  // The PowerShell drive-letter form `>> C:\Windows\…` is folded
  // into the same regex via the alternation.
  /(?:>|>>)\s*(?:\/(?!tmp\b|dev\/null\b)|[A-Z]:\\)/i,
  // `tee` over absolute paths (sudo or not). Same threat shape as
  // the redirection above — bypasses the `rm`-rooted regexes
  // because no remove command runs. `-a` (append) is allowed in
  // the regex so `echo line | tee -a /tmp/log` still slides; the
  // negative-lookahead on `/tmp` matches the redirection rule's
  // shape so the two patterns stay symmetric.
  /\btee\b\s+(?:-a\s+)?(?:\/(?!tmp\b)|[A-Z]:\\)/i,
  // `chmod` / `chown` / `icacls` rooted at `/`. `chmod -R 777 /`
  // (and the Windows `icacls C:\\ /T /grant Everyone:F` variant)
  // are catastrophic — they loosen permissions on every file the
  // process can reach. The trailing `\s|$` excludes `chmod 644 /
  // foo` (where `/` is followed by content) — only the bare-root
  // arg matches.
  /\b(?:chmod|chown|icacls)\b[^|]*\s\/(?:\s|$)/i
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((re) => re.test(command));
}

/** Relative shell redirection that escapes the workspace cwd (`../`). */
const RELATIVE_REDIRECT_ESCAPE =
  /(?:>|>>)\s*(?:\.\.(?:[\\/]|$)|\.\.[\\/])/i;

/** PowerShell write cmdlets targeting a parent path. */
const PS_PARENT_WRITE =
  /\b(?:Out-File|Set-Content|Add-Content|tee)\b[^|]*(?:\.\.[\\/]|>>\s*\.\.)/i;

/** POSIX read builtins with a parent-segment path (`cat ../outside`). */
const RELATIVE_PARENT_READ =
  /\b(?:cat|head|tail|less|more|type|nl|awk|grep|rg|ripgrep|strings|file|stat|ls|dir)\b[^|;\n&]*(?:^|[\s'"`])(?:\.\.(?:[\\/]|$)|\.\.[\\/])/i;

/** PowerShell read cmdlets targeting a parent path (`Get-Content ..\secret`). */
const PS_PARENT_READ =
  /\b(?:Get-Content|Select-String|Get-Item)\b[^|;\n]*(?:\.\.[\\/]|\\?\.\.\\)/i;

/**
 * Absolute POSIX path (excluding benign `/tmp` and `/dev/null`) or a
 * Windows drive-letter path. Used to gate bash with a confirm prompt.
 */
const ABSOLUTE_PATH_REF =
  /(?:^|[\s;&|'"`])\/(?!tmp(?:\/|$)|dev\/null(?:\s|$))[^\s;&|'"`]*/i;

const WINDOWS_DRIVE_REF = /(?:^|[\s;&|'"`])[A-Za-z]:\\[^\s;&|'"`]*/;

/**
 * Location env vars forwarded to the bash child (see `BASH_ENV_ALLOWLIST`
 * in bash.tool.ts). Resolving any of these in a command path reaches
 * outside the workspace cwd even when the literal string has no `../`.
 */
const ESCAPE_ENV_VAR_NAMES =
  'HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TMPDIR|TEMP|TMP';

/** Unix `$VAR` / `${VAR}` references to home/temp location vars. */
const UNIX_ENV_PATH_REF = new RegExp(
  `\\$(?:\\{)?(?:${ESCAPE_ENV_VAR_NAMES})(?:\\})?(?=[\\\\/]|$|[\\s;&|'"\\\`])`,
  'i'
);

/** PowerShell `$env:VAR` / `${env:VAR}`. */
const PS_ENV_PATH_REF = new RegExp(
  `\\$\\{?env:(?:${ESCAPE_ENV_VAR_NAMES})\\}?`,
  'i'
);

/** Windows CMD `%VAR%` percent expansion. */
const CMD_ENV_PATH_REF = new RegExp(
  `%(${ESCAPE_ENV_VAR_NAMES})%`,
  'i'
);

/** Tilde expansion to user home (`~`, `~/`, `~\`). */
const TILDE_HOME_REF =
  /(?:^|[\s;&|'"`(])~(?:[\\/]|$|[\s;&|'"`])/;

export function hasEnvPathEscape(command: string): boolean {
  return (
    UNIX_ENV_PATH_REF.test(command) ||
    PS_ENV_PATH_REF.test(command) ||
    CMD_ENV_PATH_REF.test(command) ||
    TILDE_HOME_REF.test(command)
  );
}

export interface BashEscapeConfirm {
  needed: boolean;
  reason?: string;
}

/**
 * Returns whether a shell command should require an extra user
 * confirm beyond the generic bash gate — absolute-path I/O or
 * workspace-relative redirects that escape via `../`.
 */
export function bashNeedsEscapeConfirm(command: string): BashEscapeConfirm {
  if (RELATIVE_PARENT_READ.test(command) || PS_PARENT_READ.test(command)) {
    return {
      needed: true,
      reason:
        'Command reads via a parent path (../) that may escape the workspace. Confirm only if you intend to read outside the project folder.'
    };
  }
  if (RELATIVE_REDIRECT_ESCAPE.test(command) || PS_PARENT_WRITE.test(command)) {
    return {
      needed: true,
      reason:
        'Command redirects output outside the workspace via a parent path (../). Confirm only if you intend to write outside the project folder.'
    };
  }
  if (ABSOLUTE_PATH_REF.test(command) || WINDOWS_DRIVE_REF.test(command)) {
    return {
      needed: true,
      reason:
        'Command references an absolute filesystem path outside the workspace sandbox. Confirm only if you intend to read or write outside the project folder.'
    };
  }
  if (hasEnvPathEscape(command)) {
    return {
      needed: true,
      reason:
        'Command references a home or temp directory via an environment variable or tilde (~) that may resolve outside the workspace. Confirm only if you intend to read or write outside the project folder.'
    };
  }
  return { needed: false };
}
