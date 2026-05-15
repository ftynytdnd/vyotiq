/**
 * `retrieveRelevantMemory` tests — the three branches that matter:
 *
 *   1. Score-weighted path: at least one note has a positive keyword
 *      score → returns top-N sorted by score, UNCHANGED from the pre-
 *      fallback behavior.
 *
 *   2. Recency fallback (plan §8): zero keyword matches AND at least
 *      one note exists on disk → returns the most-recent
 *      `RECENCY_FALLBACK_N` notes under `scope: 'workspace-recent'`
 *      with a "(shown by recency, not keyword match)" prefix. This is
 *      what closes the screenshots §4 regression where short single-
 *      token continuation prompts always produced an empty
 *      `<recent_memory>` — reinforcing the agent's false "session is
 *      fresh" conclusion.
 *
 *   3. Empty workspace: zero keyword matches AND zero notes → empty
 *      notes array, unchanged.
 *
 * Global meta-rules always return in full; those are covered by the
 * `globalMeta.ts` store tests. We stub `readGlobalMetaRules` here so
 * the return value is deterministic.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@main/memory/workspaceNotes', () => ({
  listWorkspaceNotes: vi.fn()
}));
vi.mock('@main/memory/globalMeta', () => ({
  readGlobalMetaRules: vi.fn()
}));

import { retrieveRelevantMemory } from '@main/memory/retrieval';
import { listWorkspaceNotes } from '@main/memory/workspaceNotes';
import { readGlobalMetaRules } from '@main/memory/globalMeta';

beforeEach(() => {
  vi.mocked(readGlobalMetaRules).mockResolvedValue('# meta');
});

describe('retrieveRelevantMemory', () => {
  describe('score-weighted path (unchanged)', () => {
    it('returns notes with score > 0 sorted desc', async () => {
      vi.mocked(listWorkspaceNotes).mockResolvedValue([
        { key: 'a.md', content: 'mentions deepseek once', updatedAt: 1 },
        { key: 'b.md', content: 'deepseek deepseek deepseek triple', updatedAt: 2 },
        { key: 'c.md', content: 'completely unrelated content', updatedAt: 3 }
      ]);
      const { notes } = await retrieveRelevantMemory('deepseek');
      expect(notes).toHaveLength(2);
      expect(notes[0]?.key).toBe('b.md'); // higher score first
      expect(notes[1]?.key).toBe('a.md');
      // All matched notes retain the canonical `workspace` scope —
      // distinguishing a scored hit from the fallback's `workspace-recent`.
      expect(notes.every((n) => n.scope === 'workspace')).toBe(true);
    });

    it('respects the topN cap on scored hits', async () => {
      vi.mocked(listWorkspaceNotes).mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          key: `n${i}.md`,
          content: 'widget widget widget',
          updatedAt: i
        }))
      );
      const { notes } = await retrieveRelevantMemory('widget', 3);
      expect(notes).toHaveLength(3);
    });
  });

  describe('recency fallback (plan §8)', () => {
    /**
     * The key fix: a short prompt that tokenizes to a single token
     * must no longer produce an empty envelope when notes exist. We
     * pick a query whose token does not appear in any note body so the
     * scored path returns zero, then assert the fallback kicks in.
     * The query string itself is incidental — the trigger is
     * `top.length === 0`, not any specific word.
     */
    it('surfaces up to 2 most-recent notes when scored path is empty', async () => {
      vi.mocked(listWorkspaceNotes).mockResolvedValue([
        { key: 'recent.md', content: 'tailwind v4 migration details', updatedAt: 300 },
        { key: 'older.md', content: 'settings blob shape notes', updatedAt: 200 },
        { key: 'oldest.md', content: 'first-ever note', updatedAt: 100 }
      ]);
      const { notes } = await retrieveRelevantMemory('proceed');
      expect(notes).toHaveLength(2);
      expect(notes[0]?.key).toBe('recent.md');
      expect(notes[1]?.key).toBe('older.md');
      expect(notes.every((n) => n.scope === 'workspace-recent')).toBe(true);
      // Prefix is critical — the agent uses it to distinguish "recent
      // work" from "query-relevant". Must be present on every item.
      for (const n of notes) {
        expect(n.content).toMatch(/shown by recency, not keyword match/);
      }
    });

    it('does NOT fire when any note has a positive score', async () => {
      // Mixed fixtures: one note contains the query token. Fallback
      // MUST NOT be used — scored path wins, `workspace-recent`
      // scope must NOT appear.
      vi.mocked(listWorkspaceNotes).mockResolvedValue([
        { key: 'recent.md', content: 'irrelevant recent note', updatedAt: 500 },
        { key: 'hit.md', content: 'the answer is proceed', updatedAt: 1 }
      ]);
      const { notes } = await retrieveRelevantMemory('proceed');
      expect(notes).toHaveLength(1);
      expect(notes[0]?.key).toBe('hit.md');
      expect(notes[0]?.scope).toBe('workspace');
    });
  });

  describe('empty workspace', () => {
    it('returns an empty notes array when there are no notes at all', async () => {
      vi.mocked(listWorkspaceNotes).mockResolvedValue([]);
      const { notes } = await retrieveRelevantMemory('proceed');
      expect(notes).toEqual([]);
    });

    it('returns empty notes when listWorkspaceNotes throws', async () => {
      // The catch branch in retrieveRelevantMemory swallows the error
      // and treats the workspace as noteless — callers must never
      // see a rejected promise just because the .vyotiq/memory/
      // folder is missing or unreadable.
      vi.mocked(listWorkspaceNotes).mockRejectedValue(new Error('EACCES'));
      const { notes, metaRules } = await retrieveRelevantMemory('proceed');
      expect(notes).toEqual([]);
      // Global meta-rules are independent of the workspace path and
      // must still come back.
      expect(metaRules).toBe('# meta');
    });
  });
});
