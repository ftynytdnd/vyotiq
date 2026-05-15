/**
 * Tool runner. Resolves a tool name + arguments to a ToolResult by dispatching
 * to the registry. Used by both the orchestrator and sub-agents.
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

import type { ChatPermissions, TimelineEvent } from '@shared/types/chat.js';
import type { ToolResult } from '@shared/types/tool.js';
import type { EditApprovalPayload } from '@shared/types/ipc.js';
import { getTool, isKnownToolName } from '../tools/registry.js';
import {
  requestConfirm,
  isEditApprovalLatched,
  setEditApprovalLatch
} from './confirmBus.js';
import { lookupCachedResult, recordToolResult } from './toolResultCache.js';
import { logger } from '../logging/logger.js';

const log = logger.child('orchestrator/toolRunner');

export interface ToolRunOpts {
  workspacePath: string;
  /** Workspace id (registry id) — required for checkpoint snapshots. */
  workspaceId: string;
  /** Run id — used to thread mutations into the run manifest. */
  runId: string;
  /** Conversation id — used by the pending-change registry. */
  conversationId: string;
  permissions: ChatPermissions;
  /**
   * Strict-approvals flag for this run's workspace. Forwarded to the
   * `edit` / `delete` tools so they ask for a full-diff approval
   * before applying when set. Default false (post-hoc review).
   */
  strictApprovals: boolean;
  /** Forward TimelineEvents emitted by tools (e.g. checkpoint-entry). */
  emit: (event: TimelineEvent) => void;
  signal: AbortSignal;
  subagentId?: string;
  onProgress?: (message: string) => void;
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
    log.warn('unknown tool requested', { toolName, subagentId: opts.subagentId });
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
  // Cache check — only reached for registered tools so `tool.name` is
  // the canonical `ToolName`. A hit returns the prior successful result
  // with a "you already did this" banner prepended to `output`; tool
  // execution is skipped entirely so the 14×-read loop observed in
  // production can never burn tokens re-running `read` on a file whose
  // contents are already in the model's context.
  // Cache is scoped per (signal, owner) — the orchestrator and every
  // sub-agent get their own bucket so parallel workers never cross-
  // pollute. `opts.subagentId === undefined` resolves to the
  // orchestrator bucket inside the cache. See `toolResultCache.ts`.
  const cached = lookupCachedResult(opts.signal, tool.name, args, opts.subagentId);
  if (cached) return cached;

  try {
    const result = await tool.run(args, {
      workspacePath: opts.workspacePath,
      workspaceId: opts.workspaceId,
      runId: opts.runId,
      conversationId: opts.conversationId,
      permissions: opts.permissions,
      strictApprovals: opts.strictApprovals,
      emit: opts.emit,
      signal: opts.signal,
      // Thread the run-scoped signal into the confirm bridge so a
      // pending dialog is dismissed the instant the user hits Stop,
      // instead of hanging for up to 5 min on the bus's timeout. See
      // `confirmBus.requestConfirm` for the full abort contract.
      //
      // The text-only `confirm(message)` path discards the structured
      // `ConfirmResult`'s `acceptAllRemaining` flag — destructive-
      // command / permission prompts have no "Accept all remaining"
      // affordance and the bus normalizes their bare boolean replies
      // anyway. Only `confirmEdit` reads the flag.
      confirm: async (message: string): Promise<boolean> => {
        const r = await requestConfirm(message, opts.signal);
        return r.approved;
      },
      confirmEdit: async (payload: EditApprovalPayload) => {
        // Fast path: the user already pressed "Accept all remaining"
        // earlier in this run. Skip the modal entirely.
        if (isEditApprovalLatched(opts.runId)) {
          return { approved: true, acceptAllRemaining: true };
        }
        const r = await requestConfirm('', opts.signal, payload);
        if (r.approved && r.acceptAllRemaining) {
          setEditApprovalLatch(opts.runId);
        }
        return { approved: r.approved, acceptAllRemaining: r.acceptAllRemaining };
      },
      progress: opts.onProgress,
      ...(opts.subagentId !== undefined ? { subagentId: opts.subagentId } : {})
    });
    // Record-after-run: writes invalidate the cache, reads are memoized.
    // Runs before `return` so even a caller that awaits+discards still
    // participates in the cache for the next call.
    recordToolResult(opts.signal, tool.name, args, result, opts.subagentId);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('tool threw', {
      tool: tool.name,
      subagentId: opts.subagentId,
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
