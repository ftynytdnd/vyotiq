/**
 * Tool runner. Resolves a tool name + arguments to a ToolResult by dispatching
 * to the registry for the solo Agent V run.
 *
 * Two observability passes wrap the raw registry dispatch:
 *   1. Cache lookup via `toolResultCache` — read-shaped tools with
 *      identical (name, args) short-circuit to the prior result with a
 *      banner telling the model it already asked. Write-shaped tools
 *      invalidate the cache after they run.
 *   2. Error translation — anything the tool throws is normalized into
 *      a `ToolResult { ok: false }` so the orchestrator's three-strike
 *      rule and timeline emission stay uniform.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { ToolResult } from '@shared/types/tool.js';
import { getTool, isKnownToolName } from '../tools/registry.js';
import { lookupCachedResult, recordToolResult } from './toolResultCache.js';
import { checkToolCallDedupe } from './toolCallDedupe.js';
import { logger } from '../logging/logger.js';

const log = logger.child('orchestrator/toolRunner');

export interface ToolRunOpts {
  workspacePath: string;
  workspaceId: string;
  runId: string;
  conversationId: string;
  emit: (event: TimelineEvent) => void;
  signal: AbortSignal;
  toolCallId?: string;
  onProgress?: (message: string) => void;
  /** When true, cache replays use compact/stub tiers aligned with spin detection. */
  spinSignatureHot?: boolean;
}

function blockDuplicateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  opts: ToolRunOpts
): ToolResult | null {
  const dedupeBlocked = isKnownToolName(toolName)
    ? checkToolCallDedupe(opts.signal, toolName, args)
    : null;
  if (!dedupeBlocked) return null;
  log.warn('duplicate tool call blocked', {
    tool: toolName,
    argKeys: Object.keys(args),
    runId: opts.runId,
    conversationId: opts.conversationId
  });
  return dedupeBlocked;
}

export async function runToolByName(
  toolName: string,
  args: Record<string, unknown>,
  opts: ToolRunOpts
): Promise<ToolResult> {
  // Use the registry's predicate to refine the arbitrary string into a
  // known tool name before dispatch. Unknown names produce a result with
  // the explicit `'unknown'` sentinel — never a misleading cast to a
  // registered ToolName which would mislabel the badge in the renderer.
  if (!isKnownToolName(toolName)) {
    log.warn('unknown tool requested', { toolName });
    return {
      id: 'unknown',
      name: 'unknown',
      ok: false,
      output: `Unknown tool: ${toolName}`,
      error: 'unknown tool',
      durationMs: 0
    };
  }
  const tool = getTool(toolName)!;

  // Cache before dedupe: identical read-shaped calls replay the prior ok result
  // with a pivot banner instead of emitting a synthetic duplicate_tool_call
  // failure that bloats context and trips the three-strike tool recovery path.
  const cached = lookupCachedResult(
    opts.signal,
    tool.name,
    args,
    opts.conversationId,
    opts.spinSignatureHot === true
  );
  if (cached) return cached;

  const blocked = blockDuplicateToolCall(tool.name, args, opts);
  if (blocked) return blocked;

  try {
    const result = await tool.run(args, {
      workspacePath: opts.workspacePath,
      workspaceId: opts.workspaceId,
      runId: opts.runId,
      conversationId: opts.conversationId,
      emit: opts.emit,
      signal: opts.signal,
      toolCallId: opts.toolCallId,
      progress: opts.onProgress
    });
    // Record-after-run: writes invalidate the cache, reads are memoized.
    // Runs before `return` so even a caller that awaits+discards still
    // participates in the cache for the next call.
    recordToolResult(opts.signal, tool.name, args, result, opts.conversationId);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('tool threw', {
      tool: tool.name,
      error: msg,
      stack: err instanceof Error ? err.stack : undefined
    });
    return {
      id: 'thrown',
      name: tool.name,
      ok: false,
      output: `Tool ${tool.name} threw: ${msg}`,
      error: msg,
      durationMs: 0
    };
  }
}
