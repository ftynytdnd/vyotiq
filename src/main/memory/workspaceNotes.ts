/**
 * Workspace-scoped notes. Live at `<workspace>/.vyotiq/memory/<key>.md`.
 * Each note is a separate markdown file; keys are sanitized to filenames.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_DOTDIR, MEMORY_SUBDIR } from '@shared/constants.js';
import { requireWorkspace } from '../workspace/workspaceState.js';

function memoryDir(workspacePath: string): string {
  return join(workspacePath, WORKSPACE_DOTDIR, MEMORY_SUBDIR);
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'note';
}

function ensureMd(key: string): string {
  return key.endsWith('.md') ? key : `${key}.md`;
}

/**
 * The public, model-facing key. Strips the on-disk `.md` suffix AND
 * any `.md` the caller may have tacked on, then re-sanitizes. This is
 * the value we return in `WorkspaceNote.key`, so list/read/write all
 * surface the same topic-only string and the model never needs to
 * reason about filesystem extensions. `workspaceNotePath` and the
 * internal `ensureMd` path still tack the extension back on when
 * touching disk.
 */
function publicKey(rawKey: string): string {
  const stripped = rawKey.endsWith('.md') ? rawKey.slice(0, -3) : rawKey;
  return sanitizeKey(stripped);
}

/**
 * Public accessor for the absolute path of a workspace note. Used by
 * the Memory IPC's reveal-in-folder action. Returns `null` when no
 * workspace is bound — callers must surface that as a user-visible
 * error rather than silently revealing nothing.
 */
export async function workspaceNotePath(
  key: string,
  workspacePath?: string
): Promise<string | null> {
  try {
    const ws = workspacePath ?? (await requireWorkspace());
    return join(memoryDir(ws), ensureMd(sanitizeKey(key)));
  } catch {
    return null;
  }
}

export interface WorkspaceNote {
  key: string;
  content: string;
  updatedAt: number;
}

export async function listWorkspaceNotes(
  workspacePath?: string,
  keysOnly = false
): Promise<WorkspaceNote[]> {
  const ws = workspacePath ?? (await requireWorkspace());
  const dir = memoryDir(ws);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }
  const notes: WorkspaceNote[] = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const full = join(dir, name);
    try {
      const stat = await fs.stat(full);
      const content = keysOnly ? '' : await fs.readFile(full, 'utf8');
      // Strip the on-disk `.md` suffix so the model-facing key is
      // topic-only and matches what write/append return.
      notes.push({ key: publicKey(name), content, updatedAt: stat.mtimeMs });
    } catch {
      // skip
    }
  }
  notes.sort((a, b) => b.updatedAt - a.updatedAt);
  return notes;
}

export async function readWorkspaceNote(
  key: string,
  workspacePath?: string
): Promise<WorkspaceNote | null> {
  const ws = workspacePath ?? (await requireWorkspace());
  const file = join(memoryDir(ws), ensureMd(sanitizeKey(key)));
  try {
    const content = await fs.readFile(file, 'utf8');
    const stat = await fs.stat(file);
    return { key: publicKey(key), content, updatedAt: stat.mtimeMs };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeWorkspaceNote(
  key: string,
  content: string,
  workspacePath?: string
): Promise<WorkspaceNote> {
  const ws = workspacePath ?? (await requireWorkspace());
  const dir = memoryDir(ws);
  await fs.mkdir(dir, { recursive: true });
  const safeKey = ensureMd(sanitizeKey(key));
  const file = join(dir, safeKey);
  await fs.writeFile(file, content, 'utf8');
  const stat = await fs.stat(file);
  return { key: publicKey(key), content, updatedAt: stat.mtimeMs };
}

/**
 * Per-key serialization for `appendWorkspaceNote`. Append is a
 * read-modify-write sequence (read existing note → concat line → rewrite)
 * and the pool runs up to `DEFAULT_DELEGATE_CONCURRENCY` workers in parallel,
 * each of which may call `memory.action: 'append'` against the same key
 * in the same round. Without a per-key mutex, the second write clobbers
 * the first and its line is silently lost.
 *
 * We key the chain by the SANITIZED key (the same value that determines
 * the on-disk filename) so two callers that disagree on capitalisation
 * or surrounding whitespace still converge on a single lock. Each chain
 * entry swallows its own rejection so one failing append cannot poison
 * the lock for subsequent callers — the individual `appendWorkspaceNote`
 * call still surfaces its own error to its caller.
 */
const appendChains = new Map<string, Promise<unknown>>();

export async function appendWorkspaceNote(
  key: string,
  line: string,
  workspacePath?: string
): Promise<WorkspaceNote> {
  const lockKey = ensureMd(sanitizeKey(key));
  const prior = appendChains.get(lockKey) ?? Promise.resolve();
  const next = prior.then(async () => {
    const existing = await readWorkspaceNote(key, workspacePath);
    const body = (existing?.content ?? `# ${key}\n\n`) + line.trimEnd() + '\n';
    return writeWorkspaceNote(key, body, workspacePath);
  });
  // Record a rejection-safe handle on the chain so the NEXT caller
  // awaits completion (success or failure) but does not inherit the
  // rejection. Tracked as a distinct `tailHandle` so the cleanup
  // step can reliably recognise "is this still the tail of the queue?"
  // via identity.
  const tailHandle: Promise<unknown> = next.catch(() => undefined);
  appendChains.set(lockKey, tailHandle);
  try {
    return await next;
  } finally {
    // Best-effort cleanup: if this append was the last one queued for
    // the key, drop the chain entry to prevent unbounded growth of the
    // map. A later append simply re-seeds a fresh chain.
    if (appendChains.get(lockKey) === tailHandle) {
      appendChains.delete(lockKey);
    }
  }
}
