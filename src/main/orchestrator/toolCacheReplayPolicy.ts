/**
 * Progressive cache replay — shrinks redundant context instead of hard-blocking.
 *
 * Identical read-shaped calls replay from the run cache with escalating
 * guidance. Deep repeats collapse to a reference stub so the model cannot
 * burn iterations re-ingesting the same payload while still receiving ok:true.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import type { CacheEntry } from './toolResultCacheInternals.js';

/** Full output replay with standard banner (hits 1–2). */
const FULL_REPLAY_MAX_HITS = 2;
/** Compact excerpt + strong pivot (hits 3–5, or any hit when spin is hot). */
const COMPACT_REPLAY_MAX_HITS = 5;

const COMPACT_OUTPUT_HEAD_CHARS = 480;

function baseBanner(name: ToolName, hits: number, scope: 'run' | 'conversation', spinHot: boolean): string {
  const scopeLabel = scope === 'conversation' ? 'conversation' : 'run';
  if (spinHot) {
    return (
      `[cache-hot] Identical \`${name}\` repeated ${hits}× this ${scopeLabel} and matches a hot spin signature. ` +
      `The full result is already in your transcript — do not call this again. Pivot to \`edit\`, \`search\` with new args, or \`ask_user\`.\n\n`
    );
  }
  if (hits <= FULL_REPLAY_MAX_HITS) {
    return (
      `[cache] This exact \`${name}\` was issued ${hits} time${hits === 1 ? '' : 's'} earlier in this ${scopeLabel}. ` +
      `Output may be stale after writes — re-issue only after \`edit\`/\`delete\`/\`bash\`.\n\n`
    );
  }
  if (hits <= COMPACT_REPLAY_MAX_HITS) {
    return (
      `[cache-compact] Same \`${name}\` call repeated ${hits}× — excerpt below. ` +
      `Use the prior full result in context; move to \`edit\` or planning.\n\n`
    );
  }
  return (
    `[cache-ref] Same \`${name}\` call repeated ${hits}× this ${scopeLabel}. ` +
    `Prior output is in your transcript — stop re-reading and take the next action (\`edit\`, \`ask_user\`, or a different tool).\n`
  );
}

function compactBody(fullOutput: string): string {
  const trimmed = fullOutput.trimEnd();
  if (trimmed.length <= COMPACT_OUTPUT_HEAD_CHARS) return trimmed;
  return `${trimmed.slice(0, COMPACT_OUTPUT_HEAD_CHARS)}\n…[cache excerpt — see earlier full result in transcript]`;
}

/**
 * Build a cache replay result with progressive output shrinking.
 * Never hard-blocks — always ok:true when the cached entry succeeded.
 */
export function buildSmartCacheReplay(
  entry: CacheEntry,
  name: ToolName,
  scope: 'run' | 'conversation',
  spinHot: boolean
): ToolResult {
  entry.hits += 1;
  const hits = entry.hits;

  if (entry.seeded) {
    return { ...entry.result };
  }

  const banner = baseBanner(name, hits, scope, spinHot);
  const useStub = hits > COMPACT_REPLAY_MAX_HITS || (spinHot && hits >= FULL_REPLAY_MAX_HITS);
  const useCompact =
    !useStub && (hits > FULL_REPLAY_MAX_HITS || (spinHot && hits >= 2));

  if (useStub) {
    return {
      ...entry.result,
      output: banner
    };
  }

  const body = useCompact ? compactBody(entry.result.output) : entry.result.output;
  return {
    ...entry.result,
    output: banner + body
  };
}
