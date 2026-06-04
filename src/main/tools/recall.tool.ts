/**
 * `recall` tool — cross-conversation read-only recall.
 *
 * Orchestrator-only by policy (`ORCHESTRATOR_TOOLS`). Sub-agents are
 * denied this tool so the isolation invariant from
 * `02-subagent-prompt.md` stays intact: only the top-level Agent V can
 * reach across sessions.
 *
 * Two actions:
 *
 *   - `list`: returns the recent conversation index (id, title,
 *     updatedAt, eventCount). No transcript bodies. Equivalent to the
 *     `<prior_conversations>` envelope but on demand.
 *
 *   - `read`: returns a compact, model-friendly view of one
 *     conversation's transcript. The transcript is filtered to
 *     content-bearing events only (user-prompt / agent-text / tool-call
 *     / tool-result / sub-agent rounds), streaming `*-delta` events are
 *     coalesced into one block per assistant turn, and the total output
 *     is capped at `MAX_TOOL_OUTPUT_CHARS` so the orchestrator's
 *     context window never balloons regardless of how long the
 *     recalled conversation is. Renderer-only events (`run-status`,
 *     `phase`, `agent-thought`, `token-usage`, `file-edit`,
 *     `subagent-pending`) are skipped.
 *
 * Returning the active conversation's own id is rejected — the
 * orchestrator already has its own transcript in-context via replay,
 * and a self-recall would just be a noisy duplicate.
 */

import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext } from './types.js';
import type { ToolData, ToolResult } from '@shared/types/tool.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants.js';
import {
  listConversations,
  readConversation
} from '../conversations/conversationStore.js';
import { touchRecallConversationLastReference } from '../memory/lastReferenced.js';

/**
 * Per-run map from the orchestrator's `AbortSignal` to the active
 * conversation id. Populated by `AgentV.startRun` immediately after
 * the workspace check succeeds and consumed exclusively here to
 * short-circuit a self-recall — the orchestrator's own transcript is
 * already replayed into `messages` by `replayTranscript`, so a
 * `recall read` of the active id would inject duplicate content into
 * the context window and confuse the model about which assistant
 * voice is "the current run".
 *
 * `WeakMap` keys the lifetime to the run's signal: when the run ends
 * and the signal is GC'd, the entry vanishes automatically. No
 * explicit teardown is needed — same pattern `toolResultCache` uses.
 *
 * Sub-agents inherit the orchestrator's signal (see
 * `runSubAgentPool` → `signal: opts.signal`), but the policy in
 * `tools/policy/orchestratorTools.ts` only exposes `recall` to the
 * orchestrator. If a future change adds `recall` to a sub-agent
 * allowlist, this map still resolves correctly because the signal
 * is shared.
 */
const activeConversationByRun = new WeakMap<AbortSignal, string>();

/**
 * Per-run map from the orchestrator's `AbortSignal` to the active
 * workspace id. Populated by `AgentV.startRun` so `recall list` /
 * `recall read` can scope to the run's workspace and never leak
 * transcript bodies from a sibling workspace into the context window.
 * Same WeakMap-by-signal lifetime contract as the conversation map
 * above. When unset (transient pre-binding window or a legacy single-
 * workspace caller), `recall` falls back to the unfiltered list.
 */
const activeWorkspaceByRun = new WeakMap<AbortSignal, string>();

/**
 * Bind the active conversation id to this run's signal so a
 * subsequent `recall read` can detect self-recall. Idempotent —
 * later calls overwrite earlier ones (a conversation rebind during
 * an in-flight run is exotic but harmless).
 */
export function setActiveConversationForRun(
  signal: AbortSignal,
  conversationId: string
): void {
  activeConversationByRun.set(signal, conversationId);
}

/**
 * Bind the active workspace id to this run's signal so `recall` can
 * scope its enumeration / read to that workspace. See
 * `activeWorkspaceByRun` for lifetime details.
 */
export function setActiveWorkspaceForRun(
  signal: AbortSignal,
  workspaceId: string
): void {
  activeWorkspaceByRun.set(signal, workspaceId);
}

interface RecallArgs {
  action: 'list' | 'read';
  conversationId?: string;
  /** For `read`: max events to include from the tail. Defaults to 40. */
  maxEvents?: number;
  /**
   * For `read`: hard char cap on the returned body. Defaults to
   * `MAX_TOOL_OUTPUT_CHARS`. Larger values are clamped to the default —
   * the orchestrator's context budget is the source of truth, not the
   * caller.
   */
  maxChars?: number;
}

/** Default tail size when the model doesn't pass `maxEvents`. */
const DEFAULT_MAX_EVENTS = 40;

/** Cap on how many list rows we return for `action: 'list'`. */
const LIST_LIMIT = 25;

export const recallTool: Tool = {
  name: 'recall',
  briefMarkdown: `### Tool: \`recall\`

**WHAT it is.** Read-only recall of OTHER conversations the user has had with you. The active conversation is not recallable through this tool — you already see its transcript via the host's automatic replay.

**HOW to use it.** Two actions:

\`\`\`json
{ "name": "recall", "arguments": { "action": "list" } }
{ "name": "recall", "arguments": { "action": "read", "conversationId": "<id from list>", "maxEvents": 40 } }
\`\`\`

**WHY it exists.** The \`<prior_conversations>\` envelope shows you titles and recency only. When the user references a past session by topic ("the README task we did yesterday", "the bug we fixed last week", "what did we decide about X?"), call \`recall list\` to find the right conversation, then \`recall read\` with its id.

**WHEN to trigger it.**
- The user mentions a past session by name, date, or topic.
- The user asks "did we already discuss this?" / "what did we decide?".
- You need a decision from a prior session and your current transcript is silent on it.

**Notes.** Sub-agents cannot call \`recall\` (isolation invariant). The output is bounded — long conversations are tail-trimmed and the body is hard-capped at the host's tool-output ceiling.`,
  schema: {
    type: 'function',
    function: {
      name: 'recall',
      description:
        'Read-only recall of other conversations the user has had with the agent. action="list" enumerates them (id, title, recency, eventCount); action="read" returns a compact transcript for a specific conversationId.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read'] },
          conversationId: {
            type: 'string',
            description:
              'For action="read": id of the conversation to recall. Take it from a `recall list` row or from the `<prior_conversations>` envelope.'
          },
          maxEvents: {
            type: 'number',
            description:
              'For action="read": cap on transcript events returned (most-recent first). Default 40.'
          },
          maxChars: {
            type: 'number',
            description:
              'For action="read": cap on response body chars. Clamped to the host ceiling.'
          }
        },
        required: ['action']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<RecallArgs>;

    if (a.action !== 'list' && a.action !== 'read') {
      return fail(id, started, `Error: unknown action "${String(a.action)}".`, 'invalid action');
    }

    try {
      if (a.action === 'list') {
        return await runList(id, started, ctx);
      }
      return await runRead(a, id, started, ctx);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `recall error: ${msg}`, msg);
    }
  }
};

async function runList(id: string, started: number, ctx: ToolContext): Promise<ToolResult> {
  // Scope to the run's pinned workspace so cross-workspace recall is
  // impossible. The unscoped fallback (no workspace bound to the
  // signal) keeps the legacy single-workspace behaviour intact.
  const workspaceId = activeWorkspaceByRun.get(ctx.signal);
  const list = await listConversations(workspaceId);
  if (list.length === 0) {
    return ok(
      id,
      started,
      '# No conversations on disk yet.',
      { tool: 'recall', action: 'list', count: 0, preview: '(empty)' }
    );
  }
  const top = list.slice(0, LIST_LIMIT);
  const lines: string[] = [`# Conversations (${top.length} of ${list.length})`];
  for (const m of top) {
    const updated = new Date(m.updatedAt).toISOString();
    const title = m.title && m.title !== 'New conversation' ? `"${m.title}"` : '(untitled)';
    const model = m.lastProviderId && m.lastModelId ? ` | ${m.lastProviderId}/${m.lastModelId}` : '';
    lines.push(`- ${m.id} | ${title} | updated ${updated} | ${m.eventCount} events${model}`);
  }
  if (list.length > top.length) {
    lines.push(`(${list.length - top.length} older conversations not shown.)`);
  }
  const body = lines.join('\n');
  return ok(
    id,
    started,
    body,
    {
      tool: 'recall',
      action: 'list',
      count: list.length,
      preview: body
    }
  );
}

async function runRead(
  a: Partial<RecallArgs>,
  id: string,
  started: number,
  ctx: ToolContext
): Promise<ToolResult> {
  if (typeof a.conversationId !== 'string' || a.conversationId.length === 0) {
    return fail(id, started, 'Error: `conversationId` is required for action="read".', 'missing conversationId');
  }
  // Self-recall guard: the orchestrator's own transcript is already
  // replayed into `messages` by `AgentV.startRun` → `replayTranscript`.
  // Recalling it here would inject duplicate content and confuse the
  // model. The active conversationId is registered against the run's
  // `AbortSignal` by `AgentV.startRun` via
  // `setActiveConversationForRun`; `ctx.signal` is the same signal for
  // the orchestrator path.
  const activeId = activeConversationByRun.get(ctx.signal);
  if (activeId !== undefined && activeId === a.conversationId) {
    return fail(
      id,
      started,
      'Error: refusing self-recall — the active conversation is already replayed into your message history. ' +
      'Read the prior `role:"user"` / `role:"assistant"` / `role:"tool"` turns above this one instead. ' +
      'Use `recall read` only for OTHER conversation ids returned by `recall list` or `<prior_conversations>`.',
      'self-recall refused'
    );
  }

  const targetId = a.conversationId;
  const conv = await readConversation(targetId);
  if (!conv) {
    return fail(
      id,
      started,
      `Error: no conversation found with id="${targetId}". Call \`recall list\` to see available ids.`,
      'unknown conversationId'
    );
  }
  // Workspace boundary: refuse to surface a transcript from a
  // different workspace. The renderer's `recall list` only returns
  // same-workspace ids, but the model could still try to recall by a
  // remembered id, and this guard makes the boundary structural.
  //
  // Fail-closed on legacy conversations (review finding M2). Pre-
  // workspace-pinning conversations have `conv.workspaceId === undefined`;
  // the legacy `if (runWorkspaceId && conv.workspaceId && ...)` guard
  // was a no-op for them — a stale id remembered from a different
  // workspace would silently leak its transcript into the active run.
  // Once we know the run is workspace-pinned, an unpinned conversation
  // CANNOT be safely classified as same-workspace; refuse with an
  // actionable error instead of trusting the absent id.
  const runWorkspaceId = activeWorkspaceByRun.get(ctx.signal);
  if (runWorkspaceId) {
    if (!conv.workspaceId) {
      return fail(
        id,
        started,
        `Error: conversation id="${targetId}" predates workspace pinning and is not recallable from this workspace-scoped run. ` +
        'Open the conversation in its original workspace once to migrate it; new conversations are workspace-pinned automatically.',
        'legacy conversation unpinned'
      );
    }
    if (conv.workspaceId !== runWorkspaceId) {
      return fail(
        id,
        started,
        `Error: conversation id="${targetId}" belongs to a different workspace and is not recallable from this run.`,
        'cross-workspace recall refused'
      );
    }
  }

  const requestedMax = typeof a.maxEvents === 'number' && a.maxEvents > 0
    ? Math.min(a.maxEvents, 200)
    : DEFAULT_MAX_EVENTS;
  // Tail the events so the most-recent context wins when the budget
  // forces truncation. Older context is implicitly dropped — this
  // mirrors how human "remind me what we said" usually means "remind
  // me what we said most recently".
  const tail = conv.events.slice(-requestedMax);
  const renderedBody = renderTranscript(tail);
  const titleLine = conv.title && conv.title !== 'New conversation'
    ? `"${conv.title}"`
    : '(untitled)';
  const modelLine = conv.lastProviderId && conv.lastModelId
    ? `${conv.lastProviderId}/${conv.lastModelId}`
    : '(unknown)';
  const header = [
    `# Recalled conversation`,
    `id: ${conv.id}`,
    `title: ${titleLine}`,
    `updated: ${new Date(conv.updatedAt).toISOString()}`,
    `events on disk: ${conv.eventCount}`,
    `events shown: ${tail.length} (most-recent ${tail.length} of ${conv.events.length})`,
    `last model: ${modelLine}`,
    ''
  ].join('\n');

  const fullBody = `${header}${renderedBody}`;
  // Hard cap at the host's tool-output ceiling, regardless of caller-
  // supplied `maxChars`. The cap is utf-16-safe via simple slice; the
  // orchestrator's `replayTranscript` truncator handles the same case
  // for tool results, so the model is comfortable with this shape.
  //
  // Marker length accounting: the truncation suffix itself eats budget,
  // so the slice cuts at `ceiling - TRUNC_MARKER.length` to keep the
  // total `body.length <= ceiling` strictly. Without this the test
  // `body.length <= MAX_TOOL_OUTPUT_CHARS` failed by exactly the
  // marker length.
  const ceiling = typeof a.maxChars === 'number' && a.maxChars > 0
    ? Math.min(a.maxChars, MAX_TOOL_OUTPUT_CHARS)
    : MAX_TOOL_OUTPUT_CHARS;
  const TRUNC_MARKER = '\n…[truncated]';
  const body = fullBody.length > ceiling
    ? fullBody.slice(0, Math.max(0, ceiling - TRUNC_MARKER.length)) + TRUNC_MARKER
    : fullBody;

  const recallWorkspaceId = runWorkspaceId ?? ctx.workspaceId;
  try {
    await touchRecallConversationLastReference(
      recallWorkspaceId,
      conv.id,
      ctx.conversationId
    );
  } catch {
    // Last-ref is best-effort; recall output must still return.
  }

  return ok(
    id,
    started,
    body,
    {
      tool: 'recall',
      action: 'read',
      conversationId: conv.id,
      preview: body
    }
  );
}

/**
 * Render a TimelineEvent list as a compact markdown transcript suitable
 * for the model's context. Streaming `*-delta` events for the same id
 * are coalesced into one block per turn so we don't bloat the output
 * with per-token entries. Renderer-only events are skipped entirely.
 *
 * Per-event char caps prevent a single huge tool output from
 * monopolising the budget.
 */
function renderTranscript(events: TimelineEvent[]): string {
  /** Cap on a single coalesced text block. */
  const PER_TURN_CAP = 1_500;
  /** Cap on a single tool-call/result body. */
  const PER_TOOL_CAP = 800;

  // Coalesce streaming deltas keyed by their assistant turn id.
  const textBuf = new Map<string, string>();
  const reasoningBuf = new Map<string, string>();
  const subagentOutput = new Map<string, string>();
  const subagentStatus = new Map<string, string>();

  // First pass: aggregate all delta-style accumulators so a single
  // pass over the events emits coherent blocks.
  for (const e of events) {
    switch (e.kind) {
      case 'agent-text-delta':
        textBuf.set(e.id, (textBuf.get(e.id) ?? '') + e.delta);
        break;
      case 'agent-reasoning-delta':
        reasoningBuf.set(e.id, (reasoningBuf.get(e.id) ?? '') + e.delta);
        break;
      case 'subagent-result':
        subagentOutput.set(e.subagentId, e.output);
        break;
      case 'subagent-status':
        subagentStatus.set(e.subagentId, e.status);
        break;
      default:
        break;
    }
  }

  const lines: string[] = [];
  const seenAssistantIds = new Set<string>();
  const seenSubagentIds = new Set<string>();

  for (const e of events) {
    switch (e.kind) {
      case 'user-prompt': {
        const cap = e.content.length > PER_TURN_CAP
          ? e.content.slice(0, PER_TURN_CAP) + '…'
          : e.content;
        lines.push(`### user\n${cap}`);
        break;
      }
      case 'agent-text-delta':
      case 'agent-text-end':
      case 'agent-reasoning-delta':
      case 'agent-reasoning-end':
      case 'agent-text-aborted': {
        // Emit ONCE per assistant id, on first encounter — interleaves
        // text + reasoning blocks in the order they started streaming.
        if (seenAssistantIds.has(e.id)) break;
        seenAssistantIds.add(e.id);
        const text = textBuf.get(e.id) ?? '';
        const reasoning = reasoningBuf.get(e.id) ?? '';
        if (reasoning.length === 0 && text.length === 0) break;
        const parts: string[] = ['### agent'];
        if (reasoning.length > 0) {
          const cap = reasoning.length > PER_TURN_CAP
            ? reasoning.slice(0, PER_TURN_CAP) + '…'
            : reasoning;
          parts.push(`<reasoning>\n${cap}\n</reasoning>`);
        }
        if (text.length > 0) {
          const cap = text.length > PER_TURN_CAP
            ? text.slice(0, PER_TURN_CAP) + '…'
            : text;
          parts.push(cap);
        }
        lines.push(parts.join('\n'));
        break;
      }
      case 'tool-call': {
        if (e.subagentId) break; // sub-agent internals stay isolated
        const args = JSON.stringify(e.call.args ?? {});
        const cap = args.length > PER_TOOL_CAP ? args.slice(0, PER_TOOL_CAP) + '…' : args;
        lines.push(`#### tool-call ${e.call.name}\n${cap}`);
        break;
      }
      case 'tool-result': {
        if (e.subagentId) break;
        const out = e.result.output;
        const cap = out.length > PER_TOOL_CAP ? out.slice(0, PER_TOOL_CAP) + '…' : out;
        const ok = e.result.ok ? 'ok' : 'failed';
        lines.push(`#### tool-result ${e.result.name} (${ok})\n${cap}`);
        break;
      }
      case 'subagent-spawn': {
        if (seenSubagentIds.has(e.subagentId)) break;
        seenSubagentIds.add(e.subagentId);
        const status = subagentStatus.get(e.subagentId) ?? 'unknown';
        const out = subagentOutput.get(e.subagentId) ?? '(no output captured)';
        const cap = out.length > PER_TOOL_CAP ? out.slice(0, PER_TOOL_CAP) + '…' : out;
        lines.push(`#### subagent ${e.subagentId} (${status})\ntask: ${e.task}\n${cap}`);
        break;
      }
      // Renderer-only / model-irrelevant — intentionally skipped.
      case 'phase':
      case 'agent-thought':
      case 'file-edit':
      case 'error':
      case 'subagent-pending':
      case 'subagent-status':
      case 'subagent-result':
      case 'token-usage':
      case 'run-status':
        break;
      default:
        break;
    }
  }

  return lines.length > 0 ? lines.join('\n\n') + '\n' : '(no content-bearing events.)\n';
}

function ok(id: string, started: number, output: string, data: ToolData): ToolResult {
  return { id, name: 'recall', ok: true, output, data, durationMs: Date.now() - started };
}

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'recall', ok: false, output, error, durationMs: Date.now() - started };
}
