/**
 * Pre-seed a synthetic `read` cache hit for inlined file paths.
 * Test and future host callers import from this module — not from `toolResultCache`.
 */

import type { ToolResult } from '@shared/types/tool.js';
import { logger } from '../logging/logger.js';
import { getRunCacheMap, readCacheKey } from './toolResultCacheInternals.js';

const log = logger.child('orchestrator/seedCachedRead');

/**
 * Bare `read({ path })` short-circuits with no "[cache]" banner.
 * Idempotent per `(signal, rel)`. Audit fix A4.
 */
export function seedCachedRead(signal: AbortSignal, rel: string): void {
  const key = readCacheKey({ path: rel });
  if (key === null) return;
  const map = getRunCacheMap(signal);
  if (map.has(key)) return;
  const seedResult: ToolResult = {
    id: 'seeded',
    name: 'read',
    ok: true,
    output:
      `[host] The file "${rel}" was already inlined into the <attached_files> block ` +
      `at the top of your conversation. The host has short-circuited this ` +
      `\`read\` to save you a round-trip. Use the inlined content directly. ` +
      `If you need a specific line range that exceeds the inline cap, ` +
      `re-issue \`read\` with explicit \`startLine\` / \`endLine\` — that ` +
      `call will bypass this seed and fetch fresh content.`,
    durationMs: 0
  };
  map.set(key, {
    result: seedResult,
    hits: 0,
    firstTs: Date.now(),
    seeded: true
  });
  log.debug('seeded read-cache hit', { rel });
}
