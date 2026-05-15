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
    workspace: {
      get: vi.fn(async () => ({ path: null })),
      pick: vi.fn(async () => ({ path: null })),
      set: vi.fn(async () => ({ path: null })),
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
      setContextOverride: vi.fn(async () => ({
        id: 'p1',
        name: 'stub',
        baseUrl: 'http://localhost',
        enabled: true
      }))
    },
    tokens: {
      estimate: vi.fn(async () => ({ tokens: 0, exact: false }))
    },
    chat: {
      send: vi.fn(async () => ({ ok: true, conversationId: 'c1' })),
      abort: asyncNoop,
      onEvent: subscribe,
      onDone: subscribe,
      onError: subscribe,
      listActiveRuns: vi.fn(async () => [])
    },
    conversations: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'new', title: 'Untitled', updatedAt: 0 })),
      rename: asyncNoop,
      remove: asyncNoop,
      move: vi.fn(async () => ({ id: 'new', title: 'Untitled', updatedAt: 0 }))
    },
    tools: {
      openPath: asyncNoop,
      onConfirmRequest: subscribe,
      onConfirmCancel: subscribe,
      respondConfirm: asyncNoop
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
    app: {
      info: vi.fn(async () => ({
        version: '0.0.0-test',
        electron: '0.0.0',
        node: '0.0.0',
        userDataDir: '/tmp/userdata',
        settingsFile: '/tmp/userdata/settings.json',
        logDir: '/tmp/userdata/vyotiq/logs'
      })),
      revealPath: asyncNoop
    },
    // Checkpoints slice — stubbed to safe defaults so unguarded calls
    // from a mounted Checkpoints view (or its store actions) resolve
    // cleanly. Per-test overrides via `vi.spyOn(window.vyotiq.checkpoints, ...)`
    // are the canonical way to assert wire-shape.
    checkpoints: {
      summary: vi.fn(async () => ({
        workspaceId: 'ws-stub',
        runs: [],
        files: [],
        usage: { workspaceId: 'ws-stub', blobCount: 0, bytes: 0 }
      })),
      readRun: vi.fn(async () => null),
      readFileHistory: vi.fn(async () => []),
      listPending: vi.fn(async () => []),
      acceptEntry: asyncNoop,
      acceptAll: asyncNoop,
      rejectEntry: vi.fn(async () => ({ ok: true, reverted: 0 })),
      revertEntry: vi.fn(async () => ({ ok: true, reverted: 0 })),
      revertRun: vi.fn(async () => ({ ok: true, reverted: 0 })),
      revertFileToHash: vi.fn(async () => ({ ok: true, reverted: 0 })),
      readBlob: vi.fn(async () => null),
      readCurrentFile: vi.fn(async () => null),
      exportArchive: vi.fn(async () => ({ archivePath: '/tmp/archive.json', bytes: 0 })),
      prune: vi.fn(async () => ({ removedRuns: 0, removedBlobs: 0 })),
      deleteRun: vi.fn(async () => ({ removed: true, droppedPending: 0 })),
      onChanged: subscribe
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
