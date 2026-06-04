/**
 * Parallel tool batching — independent reads should overlap in time.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn';
import type { ToolResult } from '@shared/types/tool';

const runToolByName = vi.fn();

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (name: string, args: Record<string, unknown>, ctx: unknown) =>
    runToolByName(name, args, ctx)
}));

import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';

const DELAY_MS = 45;
const baseOpts = {
  workspacePath: '/tmp/workspace',
  workspaceId: 'ws-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  permissions: {},
  signal: new AbortController().signal
};

function readCall(id: string): PartialToolCall {
  return { id, name: 'read', argumentsBuf: JSON.stringify({ path: `${id}.txt` }) };
}

beforeEach(() => {
  runToolByName.mockReset();
  runToolByName.mockImplementation(
    async (name: string): Promise<ToolResult> => {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      return {
        id: `r-${name}`,
        name: name as ToolResult['name'],
        ok: true,
        output: 'ok',
        durationMs: DELAY_MS
      };
    }
  );
});

describe('handleToolCalls — parallel independent batch', () => {
  it('overlaps three read calls in one batch', async () => {
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    const started: number[] = [];

    runToolByName.mockImplementation(async (name: string) => {
      started.push(Date.now());
      await new Promise((r) => setTimeout(r, DELAY_MS));
      return {
        id: `r-${name}`,
        name: name as ToolResult['name'],
        ok: true,
        output: 'ok',
        durationMs: DELAY_MS
      };
    });

    const t0 = Date.now();
    const summary = await handleToolCalls(
      [readCall('c1'), readCall('c2'), readCall('c3')],
      messages,
      emit,
      baseOpts
    );
    const elapsed = Date.now() - t0;

    expect(summary.attempted).toBe(3);
    expect(started).toHaveLength(3);
    // Serial would be ~3 × DELAY_MS; parallel should finish in ~1 × DELAY_MS.
    expect(elapsed).toBeLessThan(DELAY_MS * 2.5);
    expect(elapsed).toBeGreaterThanOrEqual(DELAY_MS - 5);
  });
});
