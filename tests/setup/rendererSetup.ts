/**
 * Vitest setup for the `renderer` project. Provides a happy-dom
 * environment plus a `window.vyotiq` IPC stub so components that call
 * the preload bridge don't crash on undefined methods. Each test can
 * override individual stubs via `vi.spyOn(window.vyotiq.<area>, ...)`.
 *
 * The same `electron` mock as the main project is loaded here too —
 * any shared module that imports `electron` (rare on the renderer
 * side, but possible via `@shared/types/...` hoisting) resolves to the
 * same stubs.
 */

import { afterEach, vi } from 'vitest';

// `setupFiles` runs for every project regardless of environment, so we
// gate the DOM-specific bootstrapping behind a `window` check. In node
// environment (main-process tests) this whole block becomes a no-op.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });
}

// Stub `window.vyotiq` with a fake IPC surface. Every method returns a
// resolved promise / no-op so unguarded calls in mounted components
// don't spew unhandled rejections.
function makeStubApi() {
  const noop = vi.fn();
  const asyncNoop = vi.fn(async () => undefined);
  const subscribe = () => () => { };
  return {
    window: {
      minimize: asyncNoop,
      maximizeToggle: asyncNoop,
      close: asyncNoop,
      isMaximized: vi.fn(async () => false),
      onStateChanged: subscribe,
      reload: asyncNoop,
      toggleDevTools: asyncNoop
    },
    tokens: {
      estimate: vi.fn(async () => ({ tokens: 0, exact: false }))
    },
    workspace: {
      pickDirectory: vi.fn(async () => null),
      listTree: vi.fn(async () => ({ entries: [], truncated: false, total: 0 })),
      list: vi.fn(async () => ({ activeId: null, workspaces: [] })),
      add: vi.fn(async () => ({ id: 'ws-stub', path: '/tmp', label: 'stub', addedAt: 0 })),
      setActive: vi.fn(async () => ({ activeId: null, workspaces: [] })),
      rename: vi.fn(async () => ({ id: 'ws-stub', path: '/tmp', label: 'stub', addedAt: 0 })),
      remove: vi.fn(async () => ({ activeId: null, workspaces: [] })),
      retryReachability: vi.fn(async () => ({ activeId: null, workspaces: [] }))
    },
    providers: {
      list: vi.fn(async () => []),
      add: asyncNoop,
      update: asyncNoop,
      remove: asyncNoop,
      discoverModels: vi.fn(async () => []),
      test: vi.fn(async () => ({ ok: true, message: 'ok' })),
      getAccounts: vi.fn(async () => ({})),
      refreshAccounts: vi.fn(async () => ({})),
      setAccountPollSource: asyncNoop,
      onAccountsUpdated: subscribe,
      onModelsUpdated: subscribe
    },
    chat: {
      send: vi.fn(async () => ({ ok: true, conversationId: 'c1' })),
      abort: asyncNoop,
      submitAskUser: vi.fn(async () => ({ ok: true as const })),
      onEvent: subscribe,
      onDone: subscribe,
      onError: subscribe,
      onAwaitingUser: subscribe,
      listActiveRuns: vi.fn(async () => [])
    },
    conversations: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => null),
      readTail: vi.fn(async () => null),
      readBefore: vi.fn(async () => ({ events: [], hasOlder: false })),
      export: vi.fn(async () => ({ canceled: true })),
      create: vi.fn(async () => ({ id: 'new', title: 'Untitled', updatedAt: 0 })),
      rename: asyncNoop,
      remove: asyncNoop,
      move: vi.fn(async () => ({ id: 'new', title: 'Untitled', updatedAt: 0 }))
    },
    tools: {
      openPath: asyncNoop,
      rerun: asyncNoop,
      generateRunSummary: vi.fn(async () => ({
        ok: true as const,
        title: 'Stub',
        relPath: '.vyotiq/reports/stub.html',
        bytes: 1
      }))
    },
    reports: {
      open: vi.fn(async () => ({ ok: true as const }))
    },
    memory: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => null),
      write: vi.fn(async () => ({ scope: 'global', key: 'meta-rules.md', content: '', updatedAt: 0 })),
      reveal: asyncNoop
    },
    settings: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async (patch: object) => patch)
    },
    promptCache: {
      getStatus: vi.fn(async () => ({
        geminiExplicitCache: { state: 'disabled' as const }
      }))
    },
    app: {
      info: vi.fn(async () => ({
        version: '0.0.0-test',
        electron: '0.0.0',
        node: '0.0.0',
        userDataDir: '/tmp/userdata',
        settingsFile: '/tmp/userdata/settings.json',
        logDir: '/tmp/userdata/vyotiq/logs'
      })),
      revealPath: asyncNoop,
      playWarningSound: vi.fn(async () => undefined),
      setThemeSource: asyncNoop,
      checkForUpdates: vi.fn(async () => ({
        updateAvailable: false,
        status: { phase: 'idle' as const }
      })),
      downloadUpdate: vi.fn(async () => ({ phase: 'idle' as const })),
      installUpdate: asyncNoop,
      onUpdateStatus: subscribe,
    },
    checkpoints: {
      previewRewind: vi.fn(async (input: unknown) => ({ ok: true, ...(input as object) })),
      rewindToPrompt: vi.fn(async () => ({
        ok: true as const,
        conversationId: 'conv-stub',
        workspaceId: 'ws-stub',
        promptEventId: 'prompt-stub',
        revertedRunIds: [],
        revertedFiles: [],
        failedFiles: [],
        removedTranscriptEvents: 0,
        droppedPending: 0,
        deletedRunManifests: 0
      })),
      listPending: vi.fn(async () => []),
      accept: asyncNoop,
      acceptAll: asyncNoop,
      reject: vi.fn(async () => ({ ok: true as const, reverted: 1 })),
      readBlob: vi.fn(async () => null),
      onTranscriptRewound: subscribe,
      onChanged: subscribe
    },
    harness: {
      listSections: vi.fn(async () => [
        { id: 'orchestrator-core', file: '00-orchestrator-core.md', hasOverride: false },
        { id: 'context-learning', file: '01-context-learning.md', hasOverride: false },
        { id: 'deliverables', file: '02-deliverables.md', hasOverride: false },
        { id: 'static-examples', file: '03-static-examples.md', hasOverride: false }
      ]),
      readSection: vi.fn(async (sectionId: string) => ({
        sectionId,
        bundled: `# ${sectionId}\n`,
        override: null,
        effective: `# ${sectionId}\n`
      })),
      writeSection: asyncNoop,
      resetSection: asyncNoop
    },
    editor: {
      read: vi.fn(async () => ({ content: '', mtimeMs: 0, truncated: false })),
      write: vi.fn(async () => ({ ok: true as const, mtimeMs: 0 }))
    },
    terminal: {
      attach: vi.fn(async () => ({ ok: true as const, shell: 'bash', cols: 80, rows: 24 })),
      input: asyncNoop,
      resize: asyncNoop,
      restart: asyncNoop,
      detach: asyncNoop,
      onData: subscribe,
      onExit: subscribe
    },
    completion: {
      request: vi.fn(async (input: { requestId: number }) => ({ requestId: input.requestId, text: '' })),
      cancel: asyncNoop
    },
    log: noop
  };
}

// The runtime stub doesn't structurally implement every detail of
// `VyotiqApi` (mock fns aren't perfectly type-compatible with
// arbitrary callable signatures), but the global augmentation must
// agree with the production declaration in `@shared/types/ipc.ts` —
// otherwise a "Subsequent property declarations must have the same
// type" error fires when `tsc` walks both files. Aliasing through
// `VyotiqApi` is cheap and keeps callsites' types correct; the
// runtime cast a few lines below preserves the stub's actual shape.
declare global {
  interface Window {
    vyotiq: import('@shared/types/ipc.js').VyotiqApi;
  }
}

if (typeof window !== 'undefined') {
  const stub = makeStubApi();
  (globalThis as unknown as { vyotiq: ReturnType<typeof makeStubApi> }).vyotiq = stub;
  (window as unknown as { vyotiq: ReturnType<typeof makeStubApi> }).vyotiq = stub;
}
