/**
 * `registerTokensIpc` tests — Phase 2 (2026) full-baseline estimate.
 *
 * Two surfaces under test:
 *
 *   1. **Legacy path** — `tokens:estimate` without `conversationId`
 *      keeps the original shape (`{ tokens, exact }` only). Every
 *      pre-existing renderer call site must continue to work
 *      unchanged.
 *
 *   2. **Phase 2 path** — `tokens:estimate` with `conversationId` adds
 *      a `draftTokens` + `baseline` slot whose `total` equals the
 *      sum of `systemPrompt + history + tools`. The top-level
 *      `tokens` field becomes `baseline.total + draftTokens` so a
 *      consumer that only reads `tokens` still gets the correct
 *      total.
 *
 * `getProspectiveMessages` is mocked so the test doesn't need a real
 * workspace, conversation, or harness boot. The IPC handler is the
 * surface under test — its tokenization + cache + shape contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { ChatMessage } from '@shared/types/chat';
import type { TokenizableToolSchema } from '@main/providers/tokenCounter';

// Mock `getProspectiveMessages` BEFORE importing the IPC module so the
// IPC handler closes over the mock rather than the real implementation.
vi.mock('@main/orchestrator/prospectiveMessages', () => ({
  getProspectiveMessages: vi.fn()
}));

// Workspace IPC for attachment paths — we don't want real FS lookups.
vi.mock('@main/workspace/workspaceState', async () => {
  const actual = await vi.importActual<typeof import('@main/workspace/workspaceState')>(
    '@main/workspace/workspaceState'
  );
  return {
    ...actual,
    getWorkspace: vi.fn(async () => ({ id: 'ws-test', label: 'Test', path: null }))
  };
});

import { getProspectiveMessages } from '@main/orchestrator/prospectiveMessages';
import {
  registerTokensIpc,
  __resetTokensIpcCacheForTests
} from '@main/ipc/tokens.ipc';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}
const mockIpc = ipcMain as unknown as MockIpcMain;
const getProspectiveMock = vi.mocked(getProspectiveMessages);

interface EstimateOutput {
  tokens: number;
  exact: boolean;
  draftTokens?: number;
  baseline?: {
    total: number;
    systemPrompt: number;
    history: number;
    tools: number;
  };
}

function fakeTools(): TokenizableToolSchema[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a file.',
        parameters: { type: 'object', properties: { path: { type: 'string' } } }
      }
    }
  ];
}

beforeEach(() => {
  __resetTokensIpcCacheForTests();
  getProspectiveMock.mockReset();
  registerTokensIpc();
});

afterEach(() => {
  mockIpc.__handlers.delete(IPC.TOKENS_ESTIMATE);
});

describe('tokens:estimate — legacy shape (no conversationId)', () => {
  it('returns just tokens + exact (no baseline / draftTokens slots)', async () => {
    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'Hello, world.'
    })) as EstimateOutput;
    expect(r.tokens).toBeGreaterThan(0);
    expect(r.exact).toBe(true);
    expect(r.draftTokens).toBeUndefined();
    expect(r.baseline).toBeUndefined();
    // Mock must NOT have been called when no conversationId is supplied.
    expect(getProspectiveMock).not.toHaveBeenCalled();
  });

  it('returns a small framing-only count for an empty prompt', async () => {
    // `estimateTokens` runs through `encodeChat([{role:'user', content:''}])`
    // which adds per-message role/separator framing tokens even for an
    // empty body. Bound the value rather than asserting `=== 0` so the
    // test reflects how the wire actually serializes (≤ 10 tokens on
    // o200k for the role marker + boundary).
    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: ''
    })) as EstimateOutput;
    expect(r.tokens).toBeGreaterThanOrEqual(0);
    expect(r.tokens).toBeLessThan(10);
    expect(r.exact).toBe(true);
  });

  it('falls back to chars/3.8 for Claude-family models', async () => {
    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'claude-sonnet-4.6',
      prompt: 'a'.repeat(380)
    })) as EstimateOutput;
    expect(r.exact).toBe(false);
    expect(r.tokens).toBe(100); // 380 / 3.8
  });
});

describe('tokens:estimate — Phase 2 full-baseline shape', () => {
  it('skips the baseline path when modelId is empty', async () => {
    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: '',
      prompt: 'hi',
      conversationId: 'c-1'
    })) as EstimateOutput;
    expect(r.baseline).toBeUndefined();
    expect(getProspectiveMock).not.toHaveBeenCalled();
  });

  it('returns the baseline + draft breakdown for an empty conversation', async () => {
    getProspectiveMock.mockResolvedValue({
      messages: [
        { role: 'system', content: 'You are Agent V. Operate carefully.' } satisfies ChatMessage
      ],
      tools: fakeTools(),
      source: 'fresh-conversation'
    });

    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'Refactor my composer.',
      conversationId: 'c-empty'
    })) as EstimateOutput;

    expect(r.baseline).toBeDefined();
    expect(r.draftTokens).toBeDefined();
    expect(r.baseline!.systemPrompt).toBeGreaterThan(0);
    expect(r.baseline!.history).toBe(0); // no history yet
    expect(r.baseline!.tools).toBeGreaterThan(0);
    expect(r.baseline!.total).toBe(
      r.baseline!.systemPrompt + r.baseline!.history + r.baseline!.tools
    );
    // Top-level tokens carries the FULL prospective payload.
    expect(r.tokens).toBe(r.baseline!.total + r.draftTokens!);
    // draftTokens > 0 because we supplied a non-empty prompt.
    expect(r.draftTokens!).toBeGreaterThan(0);
    expect(getProspectiveMock).toHaveBeenCalledWith('c-empty');
  });

  it('non-empty conversation: history > 0', async () => {
    getProspectiveMock.mockResolvedValue({
      messages: [
        { role: 'system', content: 'You are Agent V.' },
        { role: 'user', content: 'Show me the README.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c-1',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"README.md"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'c-1', name: 'read', content: '# Vyotiq\n\nSome content.' },
        { role: 'assistant', content: 'Here is the README contents.' }
      ] satisfies ChatMessage[],
      tools: fakeTools(),
      source: 'replay'
    });

    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'Now write a feature blurb.',
      conversationId: 'c-with-history'
    })) as EstimateOutput;
    expect(r.baseline!.history).toBeGreaterThan(0);
    expect(r.baseline!.systemPrompt).toBeGreaterThan(0);
    expect(r.baseline!.tools).toBeGreaterThan(0);
    // Total is still the sum.
    expect(r.baseline!.total).toBe(
      r.baseline!.systemPrompt + r.baseline!.history + r.baseline!.tools
    );
  });

  it('caches the baseline within TTL so a keystroke burst only computes once', async () => {
    getProspectiveMock.mockResolvedValue({
      messages: [{ role: 'system', content: 'Cached harness.' }] satisfies ChatMessage[],
      tools: fakeTools(),
      source: 'fresh-conversation'
    });

    // Three rapid calls — simulates a typing burst with the draft
    // growing one character at a time. The baseline is shared between
    // them; only the draft tokens differ.
    const r1 = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'a',
      conversationId: 'c-cache'
    })) as EstimateOutput;
    const r2 = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'ab',
      conversationId: 'c-cache'
    })) as EstimateOutput;
    const r3 = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'abc',
      conversationId: 'c-cache'
    })) as EstimateOutput;

    expect(getProspectiveMock).toHaveBeenCalledTimes(1);
    // All three share the same baseline.
    expect(r1.baseline!.total).toBe(r2.baseline!.total);
    expect(r2.baseline!.total).toBe(r3.baseline!.total);
    // Draft monotonically grows.
    expect(r3.draftTokens!).toBeGreaterThanOrEqual(r1.draftTokens!);
  });

  it('rebuilds the baseline when conversationId changes', async () => {
    getProspectiveMock.mockResolvedValue({
      messages: [{ role: 'system', content: 'A.' }] satisfies ChatMessage[],
      tools: fakeTools(),
      source: 'fresh-conversation'
    });
    await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'hi',
      conversationId: 'c-A'
    });
    await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'hi',
      conversationId: 'c-B'
    });
    expect(getProspectiveMock).toHaveBeenCalledTimes(2);
    expect(getProspectiveMock).toHaveBeenNthCalledWith(1, 'c-A');
    expect(getProspectiveMock).toHaveBeenNthCalledWith(2, 'c-B');
  });

  it('falls through to a zero baseline when getProspectiveMessages throws', async () => {
    getProspectiveMock.mockRejectedValue(new Error('boom'));
    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'gpt-5',
      prompt: 'hi',
      conversationId: 'c-broken'
    })) as EstimateOutput;
    // Best-effort: no throw, baseline is all zeros, draft still tokenized.
    expect(r.baseline!.total).toBe(0);
    expect(r.baseline!.systemPrompt).toBe(0);
    expect(r.baseline!.history).toBe(0);
    expect(r.baseline!.tools).toBe(0);
    expect(r.draftTokens!).toBeGreaterThan(0);
    expect(r.tokens).toBe(r.draftTokens!);
  });

  it('marks exact=false when ANY part fell back to heuristic', async () => {
    getProspectiveMock.mockResolvedValue({
      messages: [{ role: 'system', content: 'Be helpful.' }] satisfies ChatMessage[],
      tools: fakeTools(),
      source: 'fresh-conversation'
    });
    const r = (await mockIpc.__invoke(IPC.TOKENS_ESTIMATE, {
      modelId: 'claude-sonnet-4.6',
      prompt: 'hi',
      conversationId: 'c-claude'
    })) as EstimateOutput;
    expect(r.exact).toBe(false);
    expect(r.baseline!.total).toBeGreaterThan(0);
  });
});
