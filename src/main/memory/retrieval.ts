/**
 * Hybrid keyword + vector retrieval over workspace notes and indexed code
 * chunks. Seeds the `<recent_memory>` envelope each turn.
 */

import { tokenizeForMemory } from '@shared/memory/textTokens.js';
import { listWorkspaceNotes } from './workspaceNotes.js';
import { readGlobalMetaRules } from './globalMeta.js';
import { isRunProgressKey } from './runProgressNote.js';
import { searchVectorIndex } from './vector/vectorSearch.js';

export interface ScoredNote {
  /**
   * `workspace-recent` — recency fallback when keyword + vector return zero.
   * `workspace-code` — vector hit from an indexed source file chunk.
   */
  scope: 'workspace' | 'workspace-recent' | 'workspace-code';
  key: string;
  content: string;
  score: number;
}

const RECENCY_FALLBACK_N = 2;
const KEYWORD_WEIGHT = 0.45;
const VECTOR_WEIGHT = 0.55;

interface Candidate {
  scope: ScoredNote['scope'];
  key: string;
  content: string;
  keywordScore: number;
  vectorScore: number;
}

function keywordScore(haystack: string, queryTokens: string[]): number {
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

function mergeCandidates(candidates: Map<string, Candidate>, next: Candidate): void {
  const id = `${next.scope}\u0000${next.key}`;
  const existing = candidates.get(id);
  if (!existing) {
    candidates.set(id, next);
    return;
  }
  existing.keywordScore = Math.max(existing.keywordScore, next.keywordScore);
  existing.vectorScore = Math.max(existing.vectorScore, next.vectorScore);
  if (next.vectorScore > existing.vectorScore || next.content.length > existing.content.length) {
    existing.content = next.content;
  }
}

function finalizeCandidates(candidates: Iterable<Candidate>, topN: number): ScoredNote[] {
  const list = [...candidates];
  if (list.length === 0) return [];
  const maxKeyword = Math.max(1, ...list.map((c) => c.keywordScore));
  const scored = list.map((c) => {
    const kw = c.keywordScore / maxKeyword;
    const vec = c.vectorScore;
    const hybrid =
      c.keywordScore > 0 && vec > 0
        ? KEYWORD_WEIGHT * kw + VECTOR_WEIGHT * vec
        : c.keywordScore > 0
          ? kw
          : vec;
    return {
      scope: c.scope,
      key: c.key,
      content: c.content,
      score: hybrid
    } satisfies ScoredNote;
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((n) => n.score > 0).slice(0, topN);
}

/**
 * Returns the top-N most relevant notes/chunks for a query, plus global meta-rules.
 */
export async function retrieveRelevantMemory(
  query: string,
  topN = 4,
  workspacePath?: string
): Promise<{ metaRules: string; notes: ScoredNote[] }> {
  const tokens = tokenizeForMemory(query);
  let rawNotes: Awaited<ReturnType<typeof listWorkspaceNotes>> = [];
  try {
    rawNotes = await listWorkspaceNotes(workspacePath);
  } catch {
    // No workspace yet — that's fine.
  }

  const candidates = new Map<string, Candidate>();
  for (const n of rawNotes) {
    if (isRunProgressKey(n.key)) continue;
    const kw = keywordScore(n.content + ' ' + n.key, tokens);
    if (kw > 0) {
      mergeCandidates(candidates, {
        scope: 'workspace',
        key: n.key,
        content: n.content,
        keywordScore: kw,
        vectorScore: 0
      });
    }
  }

  if (workspacePath) {
    try {
      const hits = await searchVectorIndex(workspacePath, query);
      for (const hit of hits) {
        if (hit.similarity <= 0.05) continue;
        if (hit.sourceKind === 'note') {
          mergeCandidates(candidates, {
            scope: 'workspace',
            key: hit.sourceKey,
            content: hit.content,
            keywordScore: 0,
            vectorScore: hit.similarity
          });
        } else {
          mergeCandidates(candidates, {
            scope: 'workspace-code',
            key: hit.relPath,
            content: `(vector match — \`${hit.relPath}\` chunk ${hit.chunkIndex + 1})\n\n${hit.content}`,
            keywordScore: 0,
            vectorScore: hit.similarity
          });
        }
      }
    } catch {
      // Vector index is best-effort; keyword path still works.
    }
  }

  const top = finalizeCandidates(candidates.values(), topN);
  const metaRules = await readGlobalMetaRules();

  if (top.length > 0) {
    return { metaRules, notes: top };
  }

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
