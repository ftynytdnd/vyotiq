/**
 * Naive keyword retrieval over the markdown memory store. Used at the start of
 * every turn to seed the `<recent_memory>` envelope.
 */

import { listWorkspaceNotes } from './workspaceNotes.js';
import { readGlobalMetaRules } from './globalMeta.js';
import { isRunProgressKey } from './runProgressNote.js';

interface ScoredNote {
  /**
   * `workspace-recent` is the recency-fallback flavour: same on-disk
   * file as `workspace`, but surfaced because the keyword scorer
   * returned zero matches (see `retrieveRelevantMemory`). Kept as a
   * distinct scope value so the agent can tell "relevant by content"
   * apart from "surfaced by mtime" when reading `<recent_memory>`.
   *
   * `'global'` used to be in this union too, but no code path ever
   * produces it — global meta-rules are returned as the separate
   * `metaRules` string and rendered as their own `<meta_rules>`
   * envelope, never as a `ScoredNote`. Keeping a dead branch here
   * implied a channel that will never actually appear in
   * `<recent_memory>`, so it was removed.
   */
  scope: 'workspace' | 'workspace-recent';
  key: string;
  content: string;
  score: number;
}

/**
 * Cap on the number of notes returned by the recency fallback. Two is
 * enough to give the agent a foothold on "what was being worked on
 * recently" without flooding `<recent_memory>` when the user sends a
 * single-token continuation prompt that doesn't keyword-match any
 * stored note. Keeping this below the `topN = 4` default of the main
 * scored path ensures the fallback is never mistaken for a scored hit.
 */
const RECENCY_FALLBACK_N = 2;

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'and', 'or', 'of',
  'to', 'in', 'on', 'for', 'with', 'as', 'by', 'at', 'this', 'that',
  'it', 'its', 'i', 'you', 'we', 'they', 'do', 'does', 'did', 'have',
  'has', 'had', 'not', 'no', 'so', 'if', 'then', 'than', 'but', 'from'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function score(haystack: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const hay = haystack.toLowerCase();
  let s = 0;
  for (const t of queryTokens) {
    let idx = 0;
    while ((idx = hay.indexOf(t, idx)) !== -1) {
      s += 1;
      idx += t.length;
    }
  }
  return s;
}

/**
 * Returns the top-N most relevant notes for a query, plus the global meta-rules
 * (always included in full).
 *
 * Recency fallback (screenshots §4 regression): short continuation
 * prompts tokenize to one or two stop-word-stripped tokens that almost
 * never match any note body — so `<recent_memory>` always came back
 * empty, reinforcing the agent's false "this session is fresh"
 * conclusion. When the scored path returns zero matches AND any notes
 * exist on disk, we surface the
 * `RECENCY_FALLBACK_N` most-recently-updated notes (already sorted
 * by `listWorkspaceNotes()` via mtime desc) under a distinct
 * `scope: 'workspace-recent'` tag and with a short prefix so the
 * agent can distinguish this from a scored hit.
 */
export async function retrieveRelevantMemory(
  query: string,
  topN = 4,
  /**
   * Pinned workspace path. Routes the note listing to the run's
   * workspace rather than the globally-active one. Optional for
   * backward compatibility with renderer-initiated callers (e.g. the
   * Settings → Memory tab) that always reflect the active workspace.
   */
  workspacePath?: string
): Promise<{ metaRules: string; notes: ScoredNote[] }> {
  const tokens = tokenize(query);
  let rawNotes: Awaited<ReturnType<typeof listWorkspaceNotes>> = [];
  try {
    rawNotes = await listWorkspaceNotes(workspacePath);
  } catch {
    // No workspace yet — that's fine.
  }
  const scored: ScoredNote[] = rawNotes
    .filter((n) => !isRunProgressKey(n.key))
    .map((n) => ({
    scope: 'workspace' as const,
    key: n.key,
    content: n.content,
    score: score(n.content + ' ' + n.key, tokens)
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter((n) => n.score > 0).slice(0, topN);
  const metaRules = await readGlobalMetaRules();

  // Scored path hit something — return it unchanged.
  if (top.length > 0) {
    return { metaRules, notes: top };
  }
  // Recency fallback. `rawNotes` is already mtime-desc (see
  // `listWorkspaceNotes`), so taking the first N gives us the most-
  // recent survivors for free. Prepend a one-line note so the agent
  // treats these as "recent work" rather than "query-relevant".
  if (rawNotes.length > 0) {
    const fallback: ScoredNote[] = rawNotes
      .filter((n) => !isRunProgressKey(n.key))
      .slice(0, RECENCY_FALLBACK_N)
      .map((n) => ({
        scope: 'workspace-recent' as const,
        key: n.key,
        content: `(shown by recency, not keyword match)\n\n${n.content}`,
        score: 0
      }));
    return { metaRules, notes: fallback };
  }
  return { metaRules, notes: [] };
}
