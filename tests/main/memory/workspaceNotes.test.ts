/**
 * `workspaceNotes.ts` tests. The file uses a real workspace temp dir
 * via `requireWorkspace`, so we mock the workspace state to point at
 * a freshly-created scratch folder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let workspace: string;

vi.mock('@main/workspace/workspaceState', () => ({
  requireWorkspace: vi.fn(async () => workspace)
}));

import {
  appendWorkspaceNote,
  listWorkspaceNotes,
  readWorkspaceNote,
  workspaceNotePath,
  writeWorkspaceNote
} from '@main/memory/workspaceNotes';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vyotiq-wsnotes-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('workspaceNotes', () => {
  it('list returns [] when the memory folder does not exist yet', async () => {
    expect(await listWorkspaceNotes()).toEqual([]);
  });

  it('write creates the file under .vyotiq/memory and returns a topic-only key', async () => {
    const note = await writeWorkspaceNote('todos', '# todo list\n- one\n');
    // Model-facing key is topic-only; the `.md` suffix is a filesystem
    // detail owned by `ensureMd` at the storage layer.
    expect(note.key).toBe('todos');
    expect(note.content).toBe('# todo list\n- one\n');
  });

  it('read returns null for missing notes', async () => {
    expect(await readWorkspaceNote('does-not-exist')).toBeNull();
  });

  it('read round-trips a previously written note with a topic-only key', async () => {
    await writeWorkspaceNote('roundtrip', 'body');
    const got = await readWorkspaceNote('roundtrip');
    expect(got?.content).toBe('body');
    expect(got?.key).toBe('roundtrip');
  });

  it('read accepts a caller-supplied `.md` suffix for backwards compatibility', async () => {
    // Legacy callers that built keys with `.md` appended still work —
    // `publicKey` strips the suffix before returning, so the caller
    // always sees the topic-only shape.
    await writeWorkspaceNote('legacy', 'body');
    const got = await readWorkspaceNote('legacy.md');
    expect(got?.key).toBe('legacy');
  });

  it('list returns notes sorted by recency with topic-only keys', async () => {
    await writeWorkspaceNote('older', 'a');
    await new Promise((r) => setTimeout(r, 25));
    await writeWorkspaceNote('newer', 'b');
    const list = await listWorkspaceNotes();
    expect(list[0]?.key).toBe('newer');
    expect(list[1]?.key).toBe('older');
  });

  it('list with keysOnly skips reading file bodies', async () => {
    await writeWorkspaceNote('lightweight', 'heavy-body-content');
    const list = await listWorkspaceNotes(undefined, true);
    expect(list).toHaveLength(1);
    expect(list[0]?.key).toBe('lightweight');
    expect(list[0]?.content).toBe('');
  });

  it('sanitizes keys with disallowed characters but keeps the returned key topic-only', async () => {
    const note = await writeWorkspaceNote('weird key  with spaces!', 'x');
    // Spaces and `!` collapse to `-`; the returned key must NOT carry
    // the on-disk `.md` suffix.
    expect(note.key).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(note.key.endsWith('.md')).toBe(false);
    expect(note.key.length).toBeGreaterThan(0);
  });

  it('append concatenates onto existing content', async () => {
    await writeWorkspaceNote('log', 'first\n');
    const after = await appendWorkspaceNote('log', 'second');
    expect(after.content.endsWith('second\n')).toBe(true);
    expect(after.content).toContain('first');
  });

  it('workspaceNotePath returns an absolute path inside the workspace', async () => {
    const p = await workspaceNotePath('foo');
    expect(p).toBeTruthy();
    expect(p?.startsWith(workspace)).toBe(true);
    expect(p?.endsWith('foo.md')).toBe(true);
  });

  // Regression: `appendWorkspaceNote` is read-modify-write (read note →
  // concat line → rewrite). The pool runs up to `DEFAULT_DELEGATE_CONCURRENCY`
  // workers at once and each can emit `memory.action: 'append'` against
  // the same key. Without a per-key mutex the second write clobbers the
  // first and its line is silently lost. The fix chains appends by the
  // SANITIZED key.
  it('serializes parallel appends on the same key so every line survives', async () => {
    await writeWorkspaceNote('log', 'seed\n');
    const lines = Array.from({ length: 12 }, (_, i) => `line-${i}`);
    await Promise.all(lines.map((l) => appendWorkspaceNote('log', l)));
    const got = await readWorkspaceNote('log');
    for (const l of lines) {
      expect(got?.content).toContain(l);
    }
  });

  it('serializes parallel appends that disagree on surrounding whitespace', async () => {
    // The lock is keyed by the SANITIZED key so two callers that
    // disagree on surrounding whitespace / separator noise still
    // converge on the same on-disk filename and therefore the same
    // mutex. `sanitizeKey` is case-sensitive, so we only vary the
    // whitespace here — that's enough to prove the lock is taken from
    // the sanitized key and not the raw input.
    const lines = Array.from({ length: 8 }, (_, i) => `variant-${i}`);
    await Promise.all(
      lines.map((l, i) =>
        appendWorkspaceNote(i % 2 === 0 ? 'shared' : '  shared  ', l)
      )
    );
    const direct = await readWorkspaceNote('shared');
    for (const l of lines) {
      expect(direct?.content).toContain(l);
    }
  });
});
