/**
 * Bash tool — cross-platform shell execution.
 *
 * On Windows we route to PowerShell; on macOS/Linux we use /bin/bash. The
 * tool is named "bash" in the harness for cognitive consistency, regardless
 * of platform.
 *
 * Safety:
 *   - cwd is locked to the workspace root.
 *   - Destructive patterns are intercepted (see sandbox.isDestructiveCommand).
 *   - Each invocation has a hard timeout.
 *   - stdout/stderr are truncated.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import type { CheckpointChangeKind } from '@shared/types/checkpoint.js';
import {
  bashNeedsEscapeConfirm,
  findSymlinksEscapingWorkspace,
  isDestructiveCommand
} from './sandbox.js';
import {
  BASH_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  BASH_SNAPSHOT_MAX_ENTRIES,
  BASH_SNAPSHOT_MAX_BYTES_PER_FILE,
  BASH_SNAPSHOT_MAX_TOTAL_BYTES,
  BASH_SNAPSHOT_HUGE_TREE_FILES
} from '@shared/constants.js';
import { recordChange } from '../checkpoints/index.js';
import { computeDiffHunks } from '@shared/text/diff/computeDiffHunks.js';
import { logger } from '../logging/logger.js';

const log = logger.child('tools/bash');

/**
 * Workspace-tree pre/post scanner for bash mutation recovery.
 *
 * Before the shell command spawns, we walk the workspace once and
 * capture, for every discovered file:
 *
 *   - its absolute path,
 *   - its mtime (existence + change detector),
 *   - when the file is a text file <= `BASH_SNAPSHOT_MAX_BYTES_PER_FILE`
 *     AND the aggregate budget `BASH_SNAPSHOT_MAX_TOTAL_BYTES` is not
 *     yet exhausted, its UTF-8 body (kept in memory for the duration
 *     of the bash call — freed as soon as the checkpoint entries
 *     are recorded post-exit).
 *
 * After the shell command exits, we scan again (mtimes only — the
 * pre-state body is already in memory) and emit:
 *
 *   - one reversible `checkpoint-entry` per changed TEXT file we
 *     captured a pre-body for,
 *   - one audit-only `checkpoint-bash-mutation` event listing every
 *     changed path we could NOT capture (binary, too-large, beyond
 *     cap, or created inside an ignored dir).
 *
 * Directories in `BASH_SCAN_IGNORE` never enter the walk — snapshotting
 * `node_modules` on every bash call would pin gigabytes of memory.
 */
const BASH_SCAN_IGNORE = new Set([
  // JS/TS ecosystem
  'node_modules',
  'dist',
  'out',
  '.next',
  '.next/cache',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.eslintcache',
  '.svelte-kit',
  '.angular',
  '.expo',
  // VCS / editor
  '.git',
  '.idea',
  '.vscode',
  // Test / coverage
  'coverage',
  '.nyc_output',
  '.pytest_cache',
  // Build tooling (other languages)
  'build',
  'target',
  'target/release',
  '.gradle',
  '.cargo',
  // Rust / Go / PHP vendoring
  'vendor',
  // Infra / IaC
  '.terraform',
  '.serverless',
  '.aws-sam',
  // Docs / static site generators
  '.docusaurus',
  // Python
  '__pycache__',
  '.venv',
  'venv',
  // Vyotiq itself
  '.vyotiq'
]);

interface PreSnapshotEntry {
  /** File mtime in ms. `null` if the file didn't exist during pre-scan. */
  mtimeMs: number | null;
  /**
   * Pre-snapshot body. `undefined` means we couldn't/chose-not-to
   * capture (binary, too large, over budget, pre-scan failure). The
   * distinction matters for post-exit classification: `undefined` →
   * audit-only, anything else → reversible entry.
   */
  preBody: string | undefined;
  /** File size in bytes at pre-scan time. */
  size: number;
}

export interface PreSnapshot {
  /** absolute path → pre-snapshot record */
  entries: Map<string, PreSnapshotEntry>;
  /** True if we hit any of the caps during the walk. */
  truncated: boolean;
  /** Running total of captured `preBody` bytes (for the aggregate cap). */
  capturedBytes: number;
}

/**
 * Lightweight binary sniff. Matches the same rule `edit`/`delete`
 * apply — any NUL byte in the first 8 KiB disqualifies the file from
 * being stored as a revertable text snapshot. Oversized files skip
 * the read entirely to avoid wasting memory on a probe we'll only
 * discard.
 */
function looksBinary(body: string): boolean {
  const probe = body.length > 8192 ? body.slice(0, 8192) : body;
  return probe.includes('\0');
}

/** Skip the expensive post-exit mtime walk for common read-only commands. */
function bashCommandLikelyMutates(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  if (
    /^(git\s+(status|log|diff|show|branch|rev-parse|grep)|npm\s+(test|run|ci)|pnpm\s|yarn\s|npx\s+vitest|cargo\s+(test|check)|go\s+test|pytest)\b/i.test(
      c
    )
  ) {
    return false;
  }
  if (
    /^(cat|head|tail|less|more|type|Get-Content|ls|dir|pwd|whoami|echo|print|wc|find\s|grep|rg\s)\b/i.test(
      c
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Exported for the dedicated unit test that pins the symlink-skip
 * sandbox boundary (review finding H2). Production callers go
 * through the `bashTool.run` entry point — no other source-tree
 * site imports this helper directly.
 *
 * `signal` (Audit fix H-05): when supplied, the dirent walk checks
 * `signal.aborted` between iterations and returns the partial snapshot
 * if the user clicks Stop. Without this, `runOrchestratorLoop` had to
 * wait for the pre-scan to drain (multi-second on large monorepos)
 * before the abort signal fired — the user saw a frozen UI mid-Stop.
 */
export async function scanWorkspaceForBash(
  root: string,
  signal?: AbortSignal
): Promise<PreSnapshot> {
  const entries = new Map<string, PreSnapshotEntry>();
  let truncated = false;
  let capturedBytes = 0;
  let filesSeen = 0;
  let hugeTree = false;
  const stack: string[] = [root];
  while (stack.length > 0) {
    if (signal?.aborted) {
      // Cooperative-abort exit. Return the partial snapshot so any
      // mutations from a still-running shell command can still be
      // partially recovered; the matching post-scan respects the
      // same signal so we never compare a partial pre against a
      // full post.
      truncated = true;
      break;
    }
    if (entries.size >= BASH_SNAPSHOT_MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const current = stack.pop()!;
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const de of dirents) {
      // Per-dirent abort check: a deeply-nested directory can hold
      // thousands of entries; outer-loop check alone wouldn't honor
      // a Stop until the current directory was drained.
      if (signal?.aborted) {
        truncated = true;
        break;
      }
      const child = join(current, de.name);
      // Hard sandbox: never follow symlinks during the bash pre-scan.
      // A workspace-rooted symlink whose target lives outside the
      // workspace (e.g. `vendor -> /etc`) would otherwise let the
      // scanner pull host file contents into the pending-changes UI
      // on any post-bash mtime flip — see review finding H2.
      if (de.isSymbolicLink()) continue;
      if (de.isDirectory()) {
        if (BASH_SCAN_IGNORE.has(de.name)) continue;
        stack.push(child);
        continue;
      }
      if (!de.isFile()) continue;
      filesSeen += 1;
      if (!hugeTree && filesSeen > BASH_SNAPSHOT_HUGE_TREE_FILES) {
        hugeTree = true;
        truncated = true;
        capturedBytes = 0;
        for (const entry of entries.values()) {
          entry.preBody = undefined;
        }
      }
      let st: import('node:fs').Stats;
      try {
        // `fs.stat` follows symlinks; we already excluded them above
        // via the dirent check, but use `lstat` as belt-and-suspenders
        // so a symlink that materializes between readdir and stat
        // (race) still gets skipped.
        st = await fs.lstat(child);
        if (st.isSymbolicLink()) continue;
      } catch {
        continue; // vanished between readdir and stat
      }
      let preBody: string | undefined;
      if (
        !hugeTree &&
        st.size <= BASH_SNAPSHOT_MAX_BYTES_PER_FILE &&
        capturedBytes + st.size <= BASH_SNAPSHOT_MAX_TOTAL_BYTES
      ) {
        try {
          const body = await fs.readFile(child, 'utf8');
          if (!looksBinary(body)) {
            preBody = body;
            capturedBytes += body.length;
          }
        } catch {
          /* unreadable — fall through to mtime-only */
        }
      } else if (!hugeTree) {
        truncated = true;
      }
      if (hugeTree && preBody !== undefined) {
        preBody = undefined;
      }
      entries.set(child, {
        mtimeMs: st.mtimeMs,
        preBody,
        size: st.size
      });
      if (entries.size >= BASH_SNAPSHOT_MAX_ENTRIES) {
        truncated = true;
        break;
      }
    }
  }
  return { entries, truncated, capturedBytes };
}

/**
 * Re-scan mtimes only (no body reads) after bash exits. Matches the
 * pre-snapshot's keyspace; any new keys are creates, missing keys are
 * deletes, and matching keys with different mtimes are modifies.
 *
 * `signal` (Audit fix H-05): same cooperative-abort contract as
 * `scanWorkspaceForBash`. The post-scan runs fire-and-forget after the
 * bash child settles, so without this check it would walk the entire
 * tree even when the run is finalised — wasted work plus a window
 * where late `recordChange` events emit through `ctx.emit` after the
 * orchestrator's `disposeStreaming` already ran.
 */
async function scanWorkspaceMtimesOnly(
  root: string,
  signal?: AbortSignal
): Promise<{ mtimes: Map<string, number>; truncated: boolean }> {
  const out = new Map<string, number>();
  const stack: string[] = [root];
  let count = 0;
  let truncated = false;
  while (stack.length > 0) {
    if (signal?.aborted) {
      truncated = true;
      break;
    }
    if (count >= BASH_SNAPSHOT_MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const current = stack.pop()!;
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const de of dirents) {
      if (signal?.aborted) {
        truncated = true;
        break;
      }
      const child = join(current, de.name);
      // Same symlink-skip rule as the pre-scanner (review finding H2):
      // a `vendor -> /etc` symlink must never enter the post-scan
      // mtime map, otherwise a host file's mtime change would be
      // attributed to the bash command and surfaced as a workspace
      // mutation.
      if (de.isSymbolicLink()) continue;
      if (de.isDirectory()) {
        if (BASH_SCAN_IGNORE.has(de.name)) continue;
        stack.push(child);
        continue;
      }
      if (!de.isFile()) continue;
      try {
        const st = await fs.lstat(child);
        if (st.isSymbolicLink()) continue;
        out.set(child, st.mtimeMs);
        count += 1;
      } catch {
        /* vanished */
      }
      if (count >= BASH_SNAPSHOT_MAX_ENTRIES) {
        truncated = true;
        break;
      }
    }
  }
  return { mtimes: out, truncated };
}

/**
 * One detected mutation, joined against the pre-snapshot's bodies.
 */
interface DetectedMutation {
  absPath: string;
  relPath: string;
  kind: CheckpointChangeKind;
  /** Body BEFORE the change. `undefined` when pre-scan couldn't capture. */
  preBody: string | undefined;
  /** Body AFTER the change. `null` for deletes, `undefined` when post-read failed. */
  postBody: string | null | undefined;
}

/**
 * Compute the mutation list by diffing the pre-snapshot's mtimes
 * against a fresh post-bash mtime scan. Reads `postBody` from disk
 * for create/modify kinds (skipping binary / oversized files — those
 * fall through to audit-only).
 *
 * Truncation safety. Both `scanWorkspaceForBash` (pre) and
 * `scanWorkspaceMtimesOnly` (post) are bounded by
 * `BASH_SNAPSHOT_MAX_ENTRIES`. When either scan hits the cap, any
 * file that existed but was skipped by the cap is INVISIBLE in the
 * matching map — `pre.entries.get(abs)` and `post.get(abs)` both
 * return `undefined` for it. Without the inline-stat guards below
 * we'd misclassify those cases as:
 *
 *   - `kind: 'create'` for an mtime-changed file the pre-scan
 *     skipped — and a later Reject on the resulting checkpoint entry
 *     would `fs.unlink()` a file that the user had on disk before
 *     bash ran (data loss).
 *   - `kind: 'delete'` for a file the post-scan skipped — and a
 *     later Reject would re-materialise the pre-body even though the
 *     file is still on disk (overwrite).
 *
 * The `pre.truncated` and `postTruncated` flags tell us when each
 * scan hit the cap. When either is set and the corresponding map
 * lacks the entry, we `lstat` the path inline to disambiguate
 * "genuinely new / removed" from "existed but past the cap":
 *
 *   - Pre-truncated + post has the path + stat says file exists:
 *     either a `modify` (we have no pre-body, route to audit-only)
 *     or a no-op (mtime didn't actually change relative to disk).
 *     The `kind === 'modify'` branch already routes to audit-only
 *     when `preEntry?.preBody === undefined`, so we just need to
 *     promote the create case correctly.
 *   - Post-truncated + pre has the path + stat says file STILL
 *     exists: not a delete, just a cap-skip. Drop the synthetic
 *     delete entirely.
 *
 * The inline stat costs at most one syscall per detected mutation.
 * On a healthy small workspace (no truncation) the guards short-
 * circuit on the truncation flags and we pay nothing.
 *
 * Exported for `bashTruncationSafety.test.ts` — same rationale as
 * `scanWorkspaceForBash`.
 */
export async function computeMutations(
  root: string,
  pre: PreSnapshot,
  post: Map<string, number>,
  postTruncated: boolean
): Promise<{ mutations: DetectedMutation[]; auditOnlyPaths: string[] }> {
  const mutations: DetectedMutation[] = [];
  const auditOnlyPaths: string[] = [];

  const visited = new Set<string>();

  // Creates + modifies.
  for (const [abs, postMtime] of post) {
      visited.add(abs);
    const preEntry = pre.entries.get(abs);
    const prevMtime = preEntry?.mtimeMs ?? null;
    if (prevMtime === postMtime) continue;
    const rel = relative(root, abs).split(sep).join('/');
    if (rel.length === 0 || rel.startsWith('..')) continue;
    let kind: CheckpointChangeKind = prevMtime === null ? 'create' : 'modify';
    // Truncation safety for `create`. When the pre-scan hit the cap
    // and this path is absent from `pre.entries`, the absence does
    // NOT prove the file is new — it might have just been past the
    // cap. Confirm with an inline `lstat` against the workspace tree
    // BEFORE reading `postBody`. We don't follow symlinks here for
    // the same reason `scanWorkspaceForBash` skips them: a symlink
    // resolving outside the workspace must never enter the
    // checkpoint store.
    if (kind === 'create' && pre.truncated) {
      // The post-scan saw the file on disk after bash, so we know it
      // exists NOW. The question is whether it existed BEFORE. We
      // can't answer that from the bounded snapshots; the best
      // recovery is to route to audit-only so a later Reject can't
      // unlink something the user already had. The auditOnlyPaths
      // surface already exists for exactly this kind of "we observed
      // a mutation but cannot reverse it".
      auditOnlyPaths.push(rel);
      continue;
    }
    // Post-body: read fresh, binary-reject.
    let postBody: string | null | undefined;
    try {
      const st = await fs.stat(abs);
      if (st.size > BASH_SNAPSHOT_MAX_BYTES_PER_FILE) {
        postBody = undefined;
      } else {
        const body = await fs.readFile(abs, 'utf8');
        postBody = looksBinary(body) ? undefined : body;
      }
    } catch {
      postBody = undefined;
    }
    // If this is a modify but pre-body was never captured, treat as
    // audit-only; we can't produce a reversible entry without the
    // pre-state blob.
    if (kind === 'modify' && preEntry?.preBody === undefined) {
      auditOnlyPaths.push(rel);
      continue;
    }
    if (postBody === undefined) {
      auditOnlyPaths.push(rel);
      continue;
    }
    mutations.push({
      absPath: abs,
      relPath: rel,
      kind,
      preBody: preEntry?.preBody,
      postBody
    });
  }

  // Deletes: in `pre` but not in `post`.
  for (const [abs, preEntry] of pre.entries) {
    if (visited.has(abs)) continue;
    const rel = relative(root, abs).split(sep).join('/');
    if (rel.length === 0 || rel.startsWith('..')) continue;
    // Truncation safety for `delete`. When the post-scan hit the cap
    // and this path is missing from `post`, the absence does NOT
    // prove the file is gone — it might have just been past the cap.
    // `lstat` the path inline; if the file is still on disk, this is
    // a cap-skip (no mutation), not a delete. We use `lstat` so a
    // dangling symlink doesn't follow through to its (potentially
    // missing) target and produce a misleading ENOENT.
    if (postTruncated) {
      try {
        const st = await fs.lstat(abs);
        if (st.isFile() || st.isSymbolicLink()) {
          // File is still there — the post-scan just didn't see it
          // because of the cap. Not a real delete, skip entirely.
          continue;
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          // Some other I/O error (EACCES on a permissions-locked
          // path, etc.). Fall through to audit-only — we can't
          // confidently revert a delete we can't even stat.
          auditOnlyPaths.push(rel);
          continue;
        }
        // ENOENT confirms the delete is real; fall through to the
        // normal recoverable / audit-only branch below.
      }
    }
    if (preEntry.preBody === undefined) {
      // Can't revert a delete we never snapshotted.
      auditOnlyPaths.push(rel);
      continue;
    }
    mutations.push({
      absPath: abs,
      relPath: rel,
      kind: 'delete',
      preBody: preEntry.preBody,
      postBody: null
    });
  }

  mutations.sort((a, b) => a.relPath.localeCompare(b.relPath));
  auditOnlyPaths.sort();
  return { mutations, auditOnlyPaths };
}

/** Count line-level additions/deletions; mirrors `edit.tool.ts`. */
function diffStats(before: string, after: string): { additions: number; deletions: number } {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const beforeSet = new Map<string, number>();
  const afterSet = new Map<string, number>();
  for (const l of beforeLines) beforeSet.set(l, (beforeSet.get(l) ?? 0) + 1);
  for (const l of afterLines) afterSet.set(l, (afterSet.get(l) ?? 0) + 1);
  let additions = 0;
  let deletions = 0;
  for (const [line, count] of afterSet) {
    const prev = beforeSet.get(line) ?? 0;
    if (count > prev) additions += count - prev;
  }
  for (const [line, count] of beforeSet) {
    const next = afterSet.get(line) ?? 0;
    if (count > next) deletions += count - next;
  }
  return { additions, deletions };
}

/**
 * Hard cap on stdout/stderr retained from a single bash invocation,
 * measured in JS string code units (UTF-16 chars), NOT bytes. The
 * name was previously `MAX_OUTPUT_BYTES` but the comparison has
 * always been against `string.length`; renamed for honesty (review
 * finding C2). For ASCII output the two are identical; multi-byte
 * UTF-8 text is decoded via a `StringDecoder` BEFORE the cap is
 * applied, so the cap is a stable character ceiling regardless of
 * encoding.
 */
const MAX_OUTPUT_CHARS = 64 * 1024;

interface BashArgs {
  command: string;
  timeoutMs?: number;
}

function platformShell(): { cmd: string; args: (command: string) => string[] } {
  if (process.platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      args: (command: string) => ['-NoProfile', '-NonInteractive', '-Command', command]
    };
  }
  return {
    cmd: '/bin/bash',
    args: (command: string) => ['-lc', command]
  };
}

const KILL_GRACE_MS = 3000;

/**
 * Kill a bash child and any descendants. Unix uses a detached process
 * group (`kill(-pid, …)`); Windows uses `taskkill /T /F`.
 */
export function killBashProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): void {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    const force = signal === 'SIGKILL' ? ['/F'] : [];
    spawn('taskkill', ['/PID', String(pid), '/T', ...force], {
      windowsHide: true,
      stdio: 'ignore'
    }).unref?.();
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* noop */
    }
  }
}

/**
 * Privacy-allowlisted env for the bash child. See the call-site comment
 * in `run()` for the full rationale (Audit fix H-01). The allowlist is
 * deliberately minimal: PATH (command resolution), Windows / *nix
 * location vars (so things like `$HOME` and `$USERPROFILE` resolve),
 * locale (so `git`, `python`, etc. produce expected text encoding),
 * and TERM (so commands that probe `isatty` get a sensible answer).
 *
 * Kept as an exported function with a per-process snapshot so a future
 * test can stub `process.env` and assert the projection. Never includes
 * any var whose name matches the secret-y patterns even if the var ends
 * up in the allowlist (defense in depth — `PATH` itself can technically
 * be a vector, but it's required for shells to function).
 */
const BASH_ENV_ALLOWLIST = new Set<string>([
  // Command resolution
  'PATH',
  'PATHEXT',
  // Windows location / shell support
  'SystemRoot',
  'SystemDrive',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'PSModulePath',
  // *nix location / shell support (HOME is intentionally allowed —
  // many tools probe `~/.cache`, `~/.config`, etc.; the model can't
  // exfiltrate $HOME's value without echoing it explicitly, and the
  // value is not a secret on its own).
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  // Windows user identity (same rationale as HOME — surfaced in
  // shell prompts and tool output already)
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  // Locale + terminal — keeps `git log`, `python`, `ls --color`, etc.
  // producing the user's expected output shape.
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TERM',
  'COLORTERM',
  // Time zone for date-aware commands
  'TZ'
]);

/**
 * Patterns that mark a variable name as secret-shaped. Any allowlisted
 * var whose name matches is still dropped — defense in depth in case a
 * user / tool ever sets e.g. `PATH_API_KEY` (unusual but the regex is
 * permissive on purpose).
 */
const SECRET_NAME_RE = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|API|AUTH|CREDENTIAL|BEARER|COOKIE|SESSION)(?:_|$)/i;

/** Credential-shaped env names never forwarded to the bash child. */
const CREDENTIAL_ENV_DENYLIST: ReadonlyArray<RegExp> = [
  /^STRIPE_/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^DATABASE_URL$/i,
  /^MONGO_URI$/i,
  /^REDIS_URL$/i,
  /^VYOTIQ_/i
];

function isDeniedBashEnvName(name: string): boolean {
  if (SECRET_NAME_RE.test(name)) return true;
  return CREDENTIAL_ENV_DENYLIST.some((re) => re.test(name));
}

function buildBashEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const name of BASH_ENV_ALLOWLIST) {
    const v = process.env[name];
    if (typeof v !== 'string' || v.length === 0) continue;
    // Belt-and-suspenders: even allowlisted names get the secret-shape
    // check. A user with `LANG_API_TOKEN=…` (unusual) is still safe.
    if (isDeniedBashEnvName(name)) continue;
    out[name] = v;
  }
  return out;
}

export const bashTool: Tool = {
  name: 'bash',
  briefMarkdown: `### Tool: \`bash\`

**WHAT it is.** A shell command runner. On Windows it routes to PowerShell; on macOS/Linux it uses \`/bin/bash\`. It is named \`bash\` in this harness for consistency.

**HOW to use it.** Call it with a single \`command\` string.
\`\`\`json
{ "name": "bash", "arguments": { "command": "git status" } }
\`\`\`

**WHY it exists.** To inspect the project (build outputs, git state, dependency graphs) and to run idempotent build/test commands.

**WHEN to trigger it.** When a question requires running an actual command (tests, builds, git inspection) rather than reading a file. Prefer \`ls\` and \`read\` for navigation.

**Safety rules.**
- The cwd is the workspace root; you cannot \`cd ..\` out.
- Destructive operations (\`rm -rf /\`, \`format c:\`, \`git reset --hard\`, etc.) require explicit user confirmation; do not attempt to bypass.
- Output is truncated at 64K chars (head retained, tail dropped).
- Each invocation has a 30-second timeout unless you override \`timeoutMs\`.

**Windows / PowerShell quirks.** On Windows the runner is PowerShell, NOT bash. Bash idioms that look universal will fail with \`exited with code 1\` and no obvious hint. The most common traps and their PowerShell replacements:
- Make a directory tree: \`New-Item -ItemType Directory -Path foo/bar -Force\` (NOT \`mkdir -p foo/bar\`).
- Move / rename: \`Move-Item src dst\` (NOT \`mv src dst\`).
- Recursive copy: \`Copy-Item src dst -Recurse\` (NOT \`cp -r src dst\`).
- Recursive delete: \`Remove-Item dst -Recurse -Force\` (NOT \`rm -rf dst\`).
- Read a file: \`Get-Content path\` (NOT \`cat path\`; \`cat\` is aliased but flags differ).
- Chain on success: separate calls or \`;\` then check \`$LASTEXITCODE\` (NOT \`&&\`).
- Heredoc / inline files: PowerShell does not support \`<<EOF\`; use \`Set-Content path -Value @"..."\` with PowerShell here-strings.

If you need bash-flavor commands specifically, prefix with \`bash -c '...'\` and the runner will hand off to a bash subprocess when one is on PATH — but the default path is PowerShell on Windows.`,
  schema: {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Run a shell command in the workspace root (PowerShell on Windows, /bin/bash elsewhere). Returns merged stdout+stderr and exit code.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to execute.' },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds. Default 30000.'
          }
        },
        required: ['command']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();

    const a = args as Partial<BashArgs>;
    const command = typeof a.command === 'string' ? a.command : '';
    if (!command.trim()) {
      return {
        id,
        name: 'bash',
        ok: false,
        output: 'Error: `command` is required.',
        error: 'missing command',
        durationMs: Date.now() - started
      };
    }

    const escapeConfirm = bashNeedsEscapeConfirm(command);
    if (escapeConfirm.needed) {
      return {
        id,
        name: 'bash',
        ok: false,
        output:
          `Bash blocked: command may reach outside the workspace.\n\n${command}\n\n${escapeConfirm.reason}`,
        error: 'workspace escape',
        durationMs: Date.now() - started
      };
    }

    if (isDestructiveCommand(command)) {
      return {
        id,
        name: 'bash',
        ok: false,
        output: `Destructive command blocked:\n\n${command}`,
        error: 'destructive blocked',
        durationMs: Date.now() - started
      };
    }

    const escapeSymlinks = await findSymlinksEscapingWorkspace(ctx.workspacePath).catch(
      () => [] as string[]
    );
    if (escapeSymlinks.length > 0) {
      const listed = escapeSymlinks.slice(0, 5).join(', ');
      const more =
        escapeSymlinks.length > 5 ? ` (+${escapeSymlinks.length - 5} more)` : '';
      return {
        id,
        name: 'bash',
        ok: false,
        output:
          `Bash blocked: workspace contains symlink(s) pointing outside the sandbox: ${listed}${more}. ` +
          'Remove or replace them before running shell commands.',
        error: 'symlink-escape',
        durationMs: Date.now() - started
      };
    }

    const { cmd, args: argsFor } = platformShell();
    const requested =
      typeof a.timeoutMs === 'number' && a.timeoutMs > 0 ? a.timeoutMs : BASH_TIMEOUT_MS;
    const timeoutMs = Math.min(requested, BASH_MAX_TIMEOUT_MS);

    // Pre-snapshot BEFORE the spawn so we can recover (or audit) file
    // mutations bash performed (rm / mv / `> file` / sed -i / etc.).
    // The scanner walks the workspace once, captures UTF-8 bodies for
    // every text file inside the per-file / aggregate caps, and
    // returns mtimes for the rest. Best-effort — a scan failure must
    // never block the command; we fall back to an empty pre-snapshot,
    // which simply means every post-exit mutation lands as audit-only.
    const preSnap: PreSnapshot = await scanWorkspaceForBash(ctx.workspacePath, ctx.signal).catch((err) => {
      log.debug('pre-bash scan failed; falling back to audit-only', {
        err: err instanceof Error ? err.message : String(err)
      });
      return { entries: new Map<string, PreSnapshotEntry>(), truncated: false, capturedBytes: 0 };
    });

    return await new Promise<ToolResult>((resolveResult) => {
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let stdoutDropped = 0;
      let stderrDropped = 0;
      let timedOut = false;
      // Streaming `data` events on a child stdio pipe fire with raw
      // Buffer chunks split at arbitrary byte boundaries. Decoding
      // each chunk independently via `Buffer.toString('utf8')`
      // corrupts any multi-byte codepoint that straddles a chunk
      // boundary (CJK / emoji output → `U+FFFD`). `StringDecoder`
      // buffers the partial trailing sequence across `write()` calls
      // and yields it on the next chunk (or via `.end()` on close),
      // so the decode is lossless regardless of how the kernel splits
      // the pipe reads. Review finding C1.
      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      // Prevents both `child.on('error')` AND `child.on('close')` from
      // resolving the outer promise. Node emits `error` followed by
      // `close` on spawn failures (ENOENT, etc.); the Promise resolution
      // is already idempotent, but the second branch still allocates a
      // ToolResult and does date/string work for nothing.
      let settled = false;
      const settle = (result: ToolResult) => {
        if (settled) return;
        settled = true;
        resolveResult(result);
      };

      const isWin = process.platform === 'win32';
      const child = spawn(cmd, argsFor(command), {
        cwd: ctx.workspacePath,
        detached: !isWin,
        // PRIVACY BOUNDARY (Audit fix H-01): build a minimal env allowlist
        // instead of inheriting `process.env`. The Prime Directives
        // explicitly forbid transmitting environment variables to
        // external servers, and the model's bash command is the
        // canonical exfil channel — `echo $OPENAI_API_KEY` (or any env
        // var the user happened to set in the shell that launched
        // Vyotiq, plus anything Electron itself exposes) would land
        // verbatim in the bash result, get folded into the next
        // assistant turn's `messages[]`, and ship outbound.
        //
        // We forward only the variables required for normal command
        // resolution + locale-correct output (`PATH`, OS-specific
        // location vars, locale vars, terminal vars). Anything else
        // (API keys, tokens, secrets, $HOME-relative dotfile paths
        // that aren't strictly needed) is dropped. The model can
        // still read files inside the workspace via the `read` tool —
        // the boundary closed here is the implicit env-var leak.
        env: buildBashEnv(),
        windowsHide: true
      });

      // Close the child's stdin immediately. The harness never pipes
      // input to bash commands, but interactive tools the model invokes
      // (`cat` with no args, a bare `python` shell, `git diff` with an
      // auto-pager, etc.) will block reading from a never-closed pipe
      // until the 30 s timeout fires. Explicit close converts those
      // accidental invocations into fast EOF-driven exits.
      try {
        child.stdin?.end();
      } catch {
        /* noop — some platforms surface a synchronous EPIPE here */
      }

      // Graceful kill (Audit fix M-12): SIGTERM first with a short
      // grace period, then SIGKILL. On Windows `child.kill` always
      // maps to TerminateProcess regardless of the signal name, so the
      // grace path is a no-op there but the SIGKILL escalation still
      // matches the documented contract. On *nix the SIGTERM gives
      // long-running children (test runners, build tools) a chance to
      // flush stdio and clean up tmp files before being torn down.
      const killHard = (): void => {
        if (child.pid !== undefined) killBashProcessTree(child.pid, 'SIGKILL');
      };
      const killGraceful = (): void => {
        if (child.pid !== undefined) killBashProcessTree(child.pid, 'SIGTERM');
        // Escalate to SIGKILL if the child is still alive after the grace.
        setTimeout(() => {
          if (!settled) killHard();
        }, KILL_GRACE_MS).unref?.();
      };

      const killTimer = setTimeout(() => {
        timedOut = true;
        killGraceful();
      }, timeoutMs);

      const onAbort = () => {
        // User Stop or run-scoped abort: try SIGTERM first, escalate.
        killGraceful();
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });

      // Append-once-truncate-once: as soon as we cross the cap, keep the head
      // and stop growing. Counts dropped bytes so the final message is honest.
      child.stdout.on('data', (b: Buffer) => {
        if (stdoutTruncated) {
          stdoutDropped += b.length;
          return;
        }
        const chunk = stdoutDecoder.write(b);
        if (chunk.length === 0) return;
        if (stdout.length + chunk.length > MAX_OUTPUT_CHARS) {
          const room = Math.max(0, MAX_OUTPUT_CHARS - stdout.length);
          stdout += chunk.slice(0, room);
          stdoutDropped += chunk.length - room;
          stdoutTruncated = true;
        } else {
          stdout += chunk;
        }
      });
      child.stderr.on('data', (b: Buffer) => {
        if (stderrTruncated) {
          stderrDropped += b.length;
          return;
        }
        const chunk = stderrDecoder.write(b);
        if (chunk.length === 0) return;
        if (stderr.length + chunk.length > MAX_OUTPUT_CHARS) {
          const room = Math.max(0, MAX_OUTPUT_CHARS - stderr.length);
          stderr += chunk.slice(0, room);
          stderrDropped += chunk.length - room;
          stderrTruncated = true;
        } else {
          stderr += chunk;
        }
      });

      child.on('error', (err) => {
        clearTimeout(killTimer);
        ctx.signal.removeEventListener('abort', onAbort);
        settle({
          id,
          name: 'bash',
          ok: false,
          output: `Spawn error: ${err.message}`,
          data: {
            tool: 'bash',
            command,
            stdout: '',
            stderr: '',
            exitCode: null,
            signal: null,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false
          },
          error: err.message,
          durationMs: Date.now() - started
        });
      });

      child.on('close', (code, signalName) => {
        clearTimeout(killTimer);
        ctx.signal.removeEventListener('abort', onAbort);
        // Flush any UTF-8 bytes still buffered by the decoder at EOF.
        // Without this, a multi-byte codepoint that arrived in the
        // FINAL `data` event but was incomplete on its own would never
        // surface — `.end()` yields the trailing replacement-char (or
        // the completed codepoint when a stray byte arrives late).
        // Review finding C1.
        const tailOut = stdoutDecoder.end();
        if (tailOut.length > 0 && !stdoutTruncated) {
          if (stdout.length + tailOut.length > MAX_OUTPUT_CHARS) {
            const room = Math.max(0, MAX_OUTPUT_CHARS - stdout.length);
            stdout += tailOut.slice(0, room);
            stdoutDropped += tailOut.length - room;
            stdoutTruncated = true;
          } else {
            stdout += tailOut;
          }
        }
        const tailErr = stderrDecoder.end();
        if (tailErr.length > 0 && !stderrTruncated) {
          if (stderr.length + tailErr.length > MAX_OUTPUT_CHARS) {
            const room = Math.max(0, MAX_OUTPUT_CHARS - stderr.length);
            stderr += tailErr.slice(0, room);
            stderrDropped += tailErr.length - room;
            stderrTruncated = true;
          } else {
            stderr += tailErr;
          }
        }
        // Post-exit mutation recovery + audit.
        //
        // Ordering contract (review finding H11): the scan is now
        // AWAITED before `settle()` resolves the outer promise. The
        // legacy code ran the scan as `void (async () => {...})()`
        // and called `settle()` in parallel — the bash tool returned
        // to the orchestrator BEFORE the scan finished, the next
        // assistant turn streamed deltas into the JSONL, and any
        // late `recordChange` events emitted via `ctx.emit`
        // interleaved with subsequent agent text. Replay then saw
        // an inconsistent ordering — `checkpoint-entry` events
        // landed AFTER the assistant's reasoning about them.
        //
        // The await delays the bash result by 50–200 ms on small
        // workspaces (multi-second on monorepos). Acceptable: the
        // scan is bounded by `BASH_SNAPSHOT_MAX_ENTRIES`, the
        // existing run-signal abort checks short-circuit each loop
        // iteration when the user clicks Stop, and the bash tool
        // is the only mutation surface where the scan is required
        // (edit/delete record their changes synchronously inline).
        //
        // Flow:
        //   1. Mtime-only post-scan.
        //   2. Join against `preSnap.entries` to classify every change
        //      as a recoverable (text + captured pre-body) entry or
        //      an audit-only path.
        //   3. For recoverable entries call `recordChange` with
        //      `source: 'bash'` — same persistence path edit/delete use.
        //   4. Emit one `checkpoint-bash-mutation` if any audit-only
        //      paths exist. A flurry of these implies the agent is
        //      bypassing the `edit` / `delete` tools with bash.
        const runPostBashScan = async (): Promise<void> => {
          if (!bashCommandLikelyMutates(command)) {
            log.debug('post-bash scan skipped: read-only command heuristic');
            return;
          }
          ctx.emit({
            kind: 'phase',
            id: randomUUID(),
            ts: Date.now(),
            label: 'Scanning workspace for mutations…',
            tooltip:
              'Post-bash mtime scan — detecting file changes to record checkpoints or audit-only rows.',
            ...(ctx.subagentId ? { subagentId: ctx.subagentId } : {})
          });
          // Audit fix H-03: post-bash scan must respect the run-scoped
          // signal. Without these checks the scan walks the entire
          // workspace tree after bash settles, and every
          // `recordChange` / `checkpoint-bash-mutation` emit pushes
          // through `ctx.emit` even after the orchestrator loop's
          // `disposeStreaming` ran for an aborted/finalised run.
          // The renderer reducer drops events for runIds it no
          // longer recognises, but the JSONL `appendEvent` chain
          // still persists them — observable as ghost checkpoint
          // rows on transcript reload after a Stop.
          if (ctx.signal.aborted) {
            log.debug('post-bash scan skipped: run aborted before scan started');
            return;
          }
          try {
            const postScan = await scanWorkspaceMtimesOnly(ctx.workspacePath, ctx.signal);
            if (ctx.signal.aborted) return;
            const { mutations, auditOnlyPaths } = await computeMutations(
              ctx.workspacePath,
              preSnap,
              postScan.mtimes,
              postScan.truncated
            );
            if (ctx.signal.aborted) return;
            for (const m of mutations) {
              if (ctx.signal.aborted) return;
              try {
                const preContent = m.preBody ?? '';
                const postContent = m.postBody ?? '';
                const stats = diffStats(preContent, postContent);
                // Hunks are only useful for `modify`; `create` /
                // `delete` are rendered by the pending panel as
                // full-body previews.
                const hunks =
                  m.kind === 'modify'
                    ? computeDiffHunks(preContent, postContent)
                    : undefined;
                await recordChange({
                  runId: ctx.runId,
                  conversationId: ctx.conversationId,
                  workspaceId: ctx.workspaceId,
                  filePath: m.relPath,
                  kind: m.kind,
                  ...(m.kind !== 'create' ? { preContent } : {}),
                  ...(m.kind !== 'delete' ? { postContent } : {}),
                  additions: stats.additions,
                  deletions: stats.deletions,
                  ...(hunks ? { hunks } : {}),
                  source: 'bash',
                  ...(ctx.subagentId ? { subagentId: ctx.subagentId } : {})
                });
              } catch (err) {
                log.debug('bash recordChange failed; continuing', {
                  path: m.relPath,
                  err: err instanceof Error ? err.message : String(err)
                });
              }
            }
            if (auditOnlyPaths.length > 0 && !ctx.signal.aborted) {
              ctx.emit({
                kind: 'checkpoint-bash-mutation',
                id: randomUUID(),
                ts: Date.now(),
                command,
                paths: auditOnlyPaths,
                ...(ctx.subagentId ? { subagentId: ctx.subagentId } : {})
              });
            }
          } catch (err) {
            log.debug('post-bash mutation scan failed', {
              err: err instanceof Error ? err.message : String(err)
            });
          }
        };

        const exitLine = timedOut
          ? '--- exit: TIMEOUT ---'
          : code === null
            ? `--- signal: ${signalName ?? 'unknown'} ---`
            : `--- exit: ${code} ---`;
        const stdoutTail = stdoutTruncated ? `\n…[truncated, ${stdoutDropped} more chars]` : '';
        const stderrTail = stderrTruncated ? `\n…[truncated, ${stderrDropped} more chars]` : '';
        const merged =
          (stdout ? `--- stdout ---\n${stdout}${stdoutTail}\n` : '') +
          (stderr ? `--- stderr ---\n${stderr}${stderrTail}\n` : '') +
          exitLine;
        const ok = !timedOut && code === 0;
        const errorField = timedOut
          ? `timed out after ${timeoutMs}ms`
          : code === null
            ? `terminated by signal ${signalName ?? 'unknown'}`
            : code !== 0
              ? `exited with code ${code}`
              : null;

        // Run the scan first, settle second. Errors inside the scan
        // are already swallowed by `runPostBashScan` (debug-logged),
        // so the outer settle ALWAYS fires — the bash result is
        // never lost to a scan failure. The `durationMs` field is
        // recomputed inside `settle` to include the scan time so
        // downstream telemetry is honest about the wait.
        runPostBashScan().finally(() => {
          settle({
            id,
            name: 'bash',
            ok,
            output: merged.trim(),
            data: {
              tool: 'bash',
              command,
              stdout,
              stderr,
              exitCode: code,
              signal: signalName ?? null,
              timedOut,
              stdoutTruncated,
              stderrTruncated
            },
            ...(errorField ? { error: errorField } : {}),
            durationMs: Date.now() - started
          });
        });
      });
    });
  }
};
