/**
 * `listActiveRuns()` and the per-conversation / per-workspace abort
 * surfaces. Pins the contract used by `chat.listActiveRuns` IPC and
 * the `removeConversation` / workspace-cascade hooks.
 *
 * The orchestrator's `startRun` body is heavy (provider HTTP, harness
 * markdown reads, etc.). We don't exercise it here — we directly
 * manipulate the in-memory `activeRuns` map by calling `startRun`'s
 * outer wiring through a stubbed dependency surface and asserting the
 * snapshot shape. For the unit-level coverage of run lifecycle there
 * are dedicated tests under `loop/`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// We mock `runOrchestratorLoop` to a never-resolving promise so
// `startRun` can register its `ActiveRun` entry and the test can
// query the snapshot before resolution. The orchestrator may spawn
// MULTIPLE loops within a single test (one per `startRun`), so we
// collect every captured resolver in a Set and drain them all on
// `afterEach` — this prevents pending mock promises from outliving
// the test that created them, which previously left `Promise<void>`
// instances dangling on the GC heap and made the file the noisiest
// source of unhandled-promise warnings during a `--silent` run.
const pendingLoopResolvers: Array<() => void> = [];

vi.mock('@main/orchestrator/loop/index.js', () => ({
  runOrchestratorLoop: vi.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        signal.addEventListener('abort', onAbort);
        pendingLoopResolvers.push(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
      })
  )
}));

// Stub the workspace lookup so `requireWorkspaceById` returns a path
// without touching the real settings blob.
vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspace: vi.fn(async () => '/tmp/ws'),
  requireWorkspaceById: vi.fn(async (_id: string) => '/tmp/ws')
}));

// `recall` tool wires per-run state via a WeakMap; not relevant here.
// Provide every export `tools/registry.ts` reaches for so the
// transitive load through `AgentV.ts` →
// `contextSummarizer/index.ts` → `streamSummary.ts` →
// `harnessLoader.ts` → `tools/registry.ts` doesn't blow up on a
// missing partial-mock surface. The two `setActive*ForRun`
// helpers are the ones `AgentV.ts` actually calls; `recallTool`
// is read by the registry's static catalogue and is a no-op stub
// here because `runOrchestratorLoop` (which is the only caller
// that exercises tool dispatch) is itself mocked above.
vi.mock('@main/tools/recall.tool.js', () => ({
  setActiveConversationForRun: vi.fn(),
  setActiveWorkspaceForRun: vi.fn(),
  recallTool: {
    name: 'recall',
    description: '',
    briefMarkdown: '',
    parameters: { type: 'object', properties: {} },
    execute: vi.fn()
  }
}));

// Skip the inlineFiles + replay machinery — `buildInitialMessages`
// just needs to return SOMETHING so `startRun` can hand off to the
// stubbed loop.
vi.mock('@main/orchestrator/contextManager.js', () => ({
  inlineFiles: vi.fn(async () => '')
}));
vi.mock('@main/orchestrator/replay/index.js', () => ({
  replayTranscript: vi.fn(() => [])
}));
vi.mock('@main/checkpoints/index.js', () => ({
  openRun: vi.fn(async () => undefined),
  finalizeRun: vi.fn(async () => undefined)
}));
vi.mock('@main/settings/settingsStore.js', () => ({
  getSettings: vi.fn(async () => ({ ui: {} }))
}));

import {
  abortRun,
  abortRunsForConversation,
  abortRunsForWorkspace,
  findAllActiveRunsForConversation,
  listActiveRuns,
  startRun
} from '@main/orchestrator/AgentV';
import type { ChatSendInput } from '@shared/types/chat';

function makeInput(over: Partial<ChatSendInput> = {}): ChatSendInput {
  return {
    runId: 'r1',
    prompt: 'hi',
    conversationId: 'c1',
    workspaceId: 'w1',
    selection: { providerId: 'p1', modelId: 'm1' },
    permissions: { allowAuto: false },
    ...over
  };
}

beforeEach(() => {
  pendingLoopResolvers.length = 0;
});

async function settleActiveRuns(): Promise<void> {
  for (const resolve of pendingLoopResolvers) {
    try {
      resolve();
    } catch {
      /* defensive */
    }
  }
  pendingLoopResolvers.length = 0;
  for (let i = 0; i < 20 && listActiveRuns().length > 0; i += 1) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

afterEach(async () => {
  await settleActiveRuns();
});

describe('listActiveRuns / abort surfaces', () => {
  it('surfaces every in-flight run with its pinned conversation + workspace', async () => {
    const events: unknown[] = [];
    const deps = {
      emit: (e: unknown) => events.push(e),
      onDone: vi.fn(),
      onError: vi.fn()
    };
    void startRun(makeInput({ runId: 'r1', conversationId: 'cA', workspaceId: 'wA' }), deps);
    void startRun(makeInput({ runId: 'r2', conversationId: 'cB', workspaceId: 'wB' }), deps);

    // Yield once so `startRun`'s pre-loop body (workspace resolve, message
    // build) finishes and the run is registered. The stubbed loop is
    // still pending its `resolveLoop`, so the entry stays alive.
    await Promise.resolve();
    await Promise.resolve();

    const runs = listActiveRuns();
    const ids = runs.map((r) => r.runId).sort();
    expect(ids).toEqual(['r1', 'r2']);
    expect(runs.find((r) => r.runId === 'r1')).toMatchObject({
      conversationId: 'cA',
      workspaceId: 'wA',
      modelId: 'm1'
    });
    expect(runs.find((r) => r.runId === 'r2')).toMatchObject({
      conversationId: 'cB',
      workspaceId: 'wB',
      modelId: 'm1'
    });
    // `startedAt` is present and recent.
    for (const r of runs) {
      expect(typeof r.startedAt).toBe('number');
      expect(r.startedAt!).toBeGreaterThan(0);
    }

    // Abort only flips the signal — entries stay until the loop settles.
    abortRun('r1');
    abortRun('r2');
    expect(listActiveRuns().map((r) => r.runId).sort()).toEqual(['r1', 'r2']);
    await settleActiveRuns();
    expect(listActiveRuns()).toEqual([]);
  });

  it('abortRunsForConversation flips only the matching run signals', async () => {
    const deps = { emit: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    void startRun(makeInput({ runId: 'r1', conversationId: 'cX', workspaceId: 'wA' }), deps);
    void startRun(makeInput({ runId: 'r2', conversationId: 'cY', workspaceId: 'wA' }), deps);
    await Promise.resolve();
    await Promise.resolve();

    expect(findAllActiveRunsForConversation('cX')).toEqual(['r1']);
    expect(findAllActiveRunsForConversation('cY')).toEqual(['r2']);

    const aborted = abortRunsForConversation('cX');
    expect(aborted).toBe(1);
    // Registry entry remains until `startRun` finally — lookup still works.
    expect(findAllActiveRunsForConversation('cX')).toEqual(['r1']);
    expect(findAllActiveRunsForConversation('cY')).toEqual(['r2']);

    for (const resolve of pendingLoopResolvers) resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('findAllActiveRunsForConversation returns every match — defense for the multi-run leak', async () => {
    // The supersede contract is "at most one run per conversation",
    // but the audit promotes the lookup from "first match" to "every
    // match" so a future race that leaks two runs into the same
    // transcript is recoverable: callers iterate and abort every id
    // they got back. This test pins the array surface contract
    // (length, both ids, no spurious sibling-conversation matches).
    const deps = { emit: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    void startRun(makeInput({ runId: 'rA1', conversationId: 'cZ', workspaceId: 'wA' }), deps);
    void startRun(makeInput({ runId: 'rA2', conversationId: 'cZ', workspaceId: 'wA' }), deps);
    void startRun(makeInput({ runId: 'rB1', conversationId: 'cOther', workspaceId: 'wA' }), deps);
    await Promise.resolve();
    await Promise.resolve();

    const matches = findAllActiveRunsForConversation('cZ').sort();
    expect(matches).toEqual(['rA1', 'rA2']);
    // Sibling conversation untouched in the result set.
    expect(findAllActiveRunsForConversation('cOther')).toEqual(['rB1']);

    await settleActiveRuns();
  });

  it('abortRunsForWorkspace aborts every run pinned to that workspace', async () => {
    const deps = { emit: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    void startRun(makeInput({ runId: 'r1', conversationId: 'cA', workspaceId: 'wA' }), deps);
    void startRun(makeInput({ runId: 'r2', conversationId: 'cB', workspaceId: 'wA' }), deps);
    void startRun(makeInput({ runId: 'r3', conversationId: 'cC', workspaceId: 'wB' }), deps);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(listActiveRuns().map((r) => r.runId).sort()).toEqual(['r1', 'r2', 'r3']);

    const aborted = abortRunsForWorkspace('wA');
    expect(aborted).toBe(2);
    await Promise.resolve();
    expect(listActiveRuns().map((r) => r.runId)).toEqual(['r3']);

    abortRun('r3');
    await settleActiveRuns();
    expect(listActiveRuns()).toEqual([]);
  });

  it('abortRun signals abort but keeps the registry entry until the loop settles', async () => {
    const deps = { emit: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    void startRun(makeInput({ runId: 'r-abort' }), deps);
    await Promise.resolve();
    await Promise.resolve();

    abortRun('r-abort');
    expect(listActiveRuns().map((r) => r.runId)).toEqual(['r-abort']);

    await settleActiveRuns();
    expect(listActiveRuns()).toEqual([]);
  });

  it('returns empty when no runs are in flight', () => {
    expect(listActiveRuns()).toEqual([]);
    expect(abortRunsForConversation('nope')).toBe(0);
    expect(abortRunsForWorkspace('nope')).toBe(0);
  });

  it('generation-safe teardown: reused runId keeps the superseding run registered', async () => {
    const deps = { emit: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    void startRun(
      makeInput({ runId: 'reuse', conversationId: 'c-old', workspaceId: 'wA' }),
      deps
    );
    await Promise.resolve();
    await Promise.resolve();
    void startRun(
      makeInput({ runId: 'reuse', conversationId: 'c-new', workspaceId: 'wA' }),
      deps
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(listActiveRuns()).toEqual([
      expect.objectContaining({ runId: 'reuse', conversationId: 'c-new' })
    ]);

    const settleFirst = pendingLoopResolvers[0];
    expect(settleFirst).toBeTypeOf('function');
    settleFirst!();
    await Promise.resolve();
    await Promise.resolve();

    expect(listActiveRuns()).toEqual([
      expect.objectContaining({ runId: 'reuse', conversationId: 'c-new' })
    ]);

    pendingLoopResolvers[1]?.();
    await settleActiveRuns();
    expect(listActiveRuns()).toEqual([]);
  });
});
