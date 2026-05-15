/**
 * Tests for the `recall` tool — cross-conversation read-only recall.
 *
 * Covers:
 *   - `action:'list'` returns a markdown index with the right shape.
 *   - `action:'read'` rehydrates a transcript with content-bearing
 *      events only (renderer-only kinds skipped).
 *   - Unknown conversation ids fail gracefully.
 *   - Output is hard-capped at the host ceiling regardless of the
 *      caller's `maxChars`.
 *   - Sub-agent isolation: the tool is NOT in `SUBAGENT_FULL_TOOLS`, so
 *      `validateSubagentToolset(['recall'])` falls back to the read-only
 *      default and silently drops `recall` — sub-agents can never see
 *      it, regardless of what the orchestrator's delegate directive
 *      tries to opt into.
 */

import { describe, expect, it } from 'vitest';
import {
  recallTool,
  setActiveConversationForRun
} from '@main/tools/recall.tool';
import {
  appendEvent,
  createConversation
} from '@main/conversations/conversationStore';
import { validateSubagentToolset } from '@main/tools/policy/subagentTools';
import type { ToolContext } from '@main/tools/types';
import type { TimelineEvent } from '@shared/types/chat';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants';

const baseCtx: ToolContext = {
  workspacePath: '/tmp',
  workspaceId: 'test-ws',
  runId: 'test-run',
  conversationId: 'test-conv',
  permissions: { allowFileWrites: false, allowBash: false, allowWebSearch: false },
  strictApprovals: false,
  signal: new AbortController().signal,
  confirm: async () => false,
  confirmEdit: async () => ({ approved: false, acceptAllRemaining: false }),
  emit: () => { }
};

function userEvt(id: string, content: string): TimelineEvent {
  return { kind: 'user-prompt', id, ts: Date.now(), content };
}
function textDelta(id: string, delta: string): TimelineEvent {
  return { kind: 'agent-text-delta', id, ts: Date.now(), delta };
}
function textEnd(id: string): TimelineEvent {
  return { kind: 'agent-text-end', id, ts: Date.now() };
}

describe('recall tool', () => {
  it('action:"list" includes recently-created conversations', async () => {
    const meta = await createConversation('ws-test');
    const result = await recallTool.run({ action: 'list' }, baseCtx);
    expect(result.ok).toBe(true);
    expect(result.name).toBe('recall');
    expect(result.output).toContain(meta.id);
    if (result.data?.tool === 'recall' && result.data.action === 'list') {
      expect(typeof result.data.count).toBe('number');
      expect(result.data.count).toBeGreaterThan(0);
    } else {
      throw new Error('expected recall list data');
    }
  });

  it('action:"read" without conversationId fails with a clear error', async () => {
    const result = await recallTool.run({ action: 'read' }, baseCtx);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/conversationId/);
  });

  it('action:"read" on an unknown conversationId fails gracefully', async () => {
    const result = await recallTool.run(
      { action: 'read', conversationId: 'no-such-id-12345' },
      baseCtx
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown conversationId');
  });

  it('action:"read" rehydrates a transcript and skips renderer-only events', async () => {
    const meta = await createConversation('ws-test');
    // Seed a small transcript with both content-bearing and renderer-
    // only events. The recall output must contain the user prompt and
    // the assistant text but NOT the renderer-only events.
    await appendEvent(meta.id, userEvt('u1', 'hello there'));
    await appendEvent(meta.id, textDelta('a1', 'hi! '));
    await appendEvent(meta.id, textDelta('a1', 'how can I help?'));
    await appendEvent(meta.id, textEnd('a1'));
    // Renderer-only kinds — must be excluded from the recall body.
    await appendEvent(meta.id, {
      kind: 'phase',
      id: 'p1',
      ts: Date.now(),
      label: 'should-not-appear-in-recall'
    });
    await appendEvent(meta.id, {
      kind: 'agent-thought',
      id: 't1',
      ts: Date.now(),
      content: 'should-not-appear-in-recall'
    });

    const result = await recallTool.run(
      { action: 'read', conversationId: meta.id },
      baseCtx
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('hello there');
    expect(result.output).toContain('hi! how can I help?');
    expect(result.output).not.toContain('should-not-appear-in-recall');
    if (result.data?.tool === 'recall' && result.data.action === 'read') {
      expect(result.data.conversationId).toBe(meta.id);
    } else {
      throw new Error('expected recall read data');
    }
  });

  it('action:"read" caps output at MAX_TOOL_OUTPUT_CHARS regardless of caller maxChars', async () => {
    const meta = await createConversation('ws-test');
    // Pump a giant single message so the rendered body would otherwise
    // exceed the ceiling. The per-turn cap inside the tool trims each
    // block to ~1.5k chars, so we use multiple turns to force the
    // overall body to exceed the host ceiling.
    const huge = 'x'.repeat(2000);
    for (let i = 0; i < 50; i++) {
      await appendEvent(meta.id, userEvt(`u${i}`, huge));
    }
    const result = await recallTool.run(
      { action: 'read', conversationId: meta.id, maxChars: 999_999_999 },
      baseCtx
    );
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS);
    expect(result.output.endsWith('…[truncated]')).toBe(true);
  });
});

describe('recall tool — self-recall guard', () => {
  /**
   * Audit follow-up: `runRead` previously documented "self-recall is
   * rejected" but the implementation only did `void ctx;` and
   * proceeded. The orchestrator could recall its own conversation,
   * injecting duplicate transcript content into a context window
   * that already had it via `replayTranscript`. The guard now lives
   * inside `runRead`, fueled by the `setActiveConversationForRun`
   * registry keyed on the run's `AbortSignal`.
   */
  it('rejects a self-recall when the active conversation matches', async () => {
    const meta = await createConversation('ws-test');
    const ctrl = new AbortController();
    setActiveConversationForRun(ctrl.signal, meta.id);

    const result = await recallTool.run(
      { action: 'read', conversationId: meta.id },
      { ...baseCtx, signal: ctrl.signal }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('self-recall refused');
    // The error message must explicitly point the model at the prior
    // turns above the current one — that's the recovery path.
    expect(result.output).toMatch(/already replayed/i);
  });

  it('still allows recalling a DIFFERENT conversation while the active id is registered', async () => {
    const active = await createConversation('ws-test');
    const other = await createConversation('ws-test');
    await appendEvent(other.id, {
      kind: 'user-prompt',
      id: 'u1',
      ts: Date.now(),
      content: 'cross-recall payload'
    });

    const ctrl = new AbortController();
    setActiveConversationForRun(ctrl.signal, active.id);

    const result = await recallTool.run(
      { action: 'read', conversationId: other.id },
      { ...baseCtx, signal: ctrl.signal }
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('cross-recall payload');
  });

  it('falls back to the original behavior when no active id was registered', async () => {
    // Legacy / orchestrator-not-bound path: the registry is empty for
    // this signal, so a recall by id of a real conversation must
    // succeed unchanged. This protects test fixtures that don't
    // bother registering an active id.
    const meta = await createConversation('ws-test');
    await appendEvent(meta.id, {
      kind: 'user-prompt',
      id: 'u1',
      ts: Date.now(),
      content: 'orphan-signal payload'
    });
    const result = await recallTool.run(
      { action: 'read', conversationId: meta.id },
      baseCtx
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('orphan-signal payload');
  });
});

describe('recall tool — sub-agent isolation', () => {
  it('validateSubagentToolset filters `recall` out — sub-agents cannot opt in', () => {
    // Even when the orchestrator's <delegate tools="..."> directive
    // explicitly lists `recall`, the policy chokepoint must drop it.
    // The subset returned is whatever survives intersection with
    // SUBAGENT_FULL_TOOLS — recall is intentionally NOT in that set.
    const filtered = validateSubagentToolset(['recall', 'read', 'ls']);
    expect(filtered).not.toContain('recall');
    expect(filtered).toContain('read');
    expect(filtered).toContain('ls');
  });

  it('validateSubagentToolset with ONLY `recall` falls back to the read-only default', () => {
    // After filtering, no allowed tools remain, so the function returns
    // the safe default rather than an empty list (which would render
    // the sub-agent useless).
    const filtered = validateSubagentToolset(['recall']);
    expect(filtered).not.toContain('recall');
    expect(filtered.length).toBeGreaterThan(0);
  });
});
