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
      listChildren: vi.fn(async () => ({ entries: [] })),
      gitStatus: vi.fn(async () => ({
        paths: {},
        staged: {},
        unstaged: {},
        entries: {},
        context: {
          isRepo: false,
          branch: null,
          headShort: null,
          dirtyCount: 0
        }
      })),
      gitFileDiff: vi.fn(async () => ({ path: '', status: 'M' as const, hunks: [] })),
      gitStage: vi.fn(async () => ({ ok: true as const })),
      gitUnstage: vi.fn(async () => ({ ok: true as const })),
      gitCommit: vi.fn(async () => ({ ok: true as const })),
      gitPush: vi.fn(async () => ({ ok: true as const })),
      gitPull: vi.fn(async () => ({ ok: true as const })),
      gitFetch: vi.fn(async () => ({ ok: true as const })),
      gitDiscard: vi.fn(async () => ({ ok: true as const })),
      gitStash: vi.fn(async () => ({ ok: true as const })),
      gitStashPop: vi.fn(async () => ({ ok: true as const })),
      gitStashDrop: vi.fn(async () => ({ ok: true as const })),
      gitStashList: vi.fn(async () => ({ stashes: [] })),
      gitBranches: vi.fn(async () => ({ branches: [] })),
      gitCheckout: vi.fn(async () => ({ ok: true as const })),
      gitCreateBranch: vi.fn(async () => ({ ok: true as const })),
      gitGenerateCommitMessage: vi.fn(async (_input, onDelta?) => {
        onDelta?.('chore: ');
        onDelta?.('update');
        return { message: 'chore: update' };
      }),
      list: vi.fn(async () => ({ activeId: null, workspaces: [] })),
      add: vi.fn(async () => ({ id: 'ws-stub', path: '/tmp', label: 'stub', addedAt: 0 })),
      setActive: vi.fn(async () => ({ activeId: null, workspaces: [] })),
      rename: vi.fn(async () => ({ id: 'ws-stub', path: '/tmp', label: 'stub', addedAt: 0 })),
      remove: vi.fn(async () => ({ activeId: null, workspaces: [] })),
      retryReachability: vi.fn(async () => ({ activeId: null, workspaces: [] })),
      switchBranch: vi.fn(async () => ({ id: 'ws-stub', path: '/tmp', label: 'stub', addedAt: 0 })),
      mkdir: vi.fn(async () => ({ ok: true as const })),
      renamePath: vi.fn(async () => ({ ok: true as const })),
      deletePath: vi.fn(async () => ({ ok: true as const })),
      revealPath: vi.fn(async () => ({ ok: true as const })),
      onTreeChanged: subscribe
    },
    providers: {
      list: vi.fn(async () => []),
      add: asyncNoop,
      update: asyncNoop,
      remove: asyncNoop,
      discoverModels: vi.fn(async () => ({ models: [], lastDiscoveredAt: 1_700_000_000_000 })),
      test: vi.fn(async () => ({ ok: true, message: 'ok' })),
      claudeCodeProxyAction: vi.fn(async () => ({ ok: true as const })),
      getAccounts: vi.fn(async () => ({})),
      refreshAccounts: vi.fn(async () => ({})),
      setAccountPollSource: asyncNoop,
      onAccountsUpdated: subscribe,
      onModelsUpdated: subscribe,
      onDiscoveryPollHint: subscribe
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
    followUps: {
      list: vi.fn(async () => ({ steering: [], queued: [] })),
      enqueue: vi.fn(async () => ({ steering: [], queued: [] })),
      update: vi.fn(async () => ({ steering: [], queued: [] })),
      remove: vi.fn(async () => ({ steering: [], queued: [] })),
      sendNow: vi.fn(async () => ({ steering: [], queued: [] })),
      onUpdated: subscribe
    },
    tasks: {
      get: vi.fn(async (conversationId: string) => ({
        conversationId,
        items: [],
        updatedAt: 0
      })),
      set: vi.fn(async (conversationId: string, items: unknown[]) => ({
        conversationId,
        items,
        updatedAt: 0
      }))
    },
    ui: {
      onToast: subscribe
    },
    heartbeat: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      attach: vi.fn(async (input) => ({
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        enabled: true,
        intervalMinutes: input.intervalMinutes,
        wakePrompt: '',
        selection: input.selection,
        createdAt: 0,
        updatedAt: 0
      })),
      detach: vi.fn(async () => ({ ok: true })),
      onUpdated: subscribe
    },
    mentions: {
      searchSymbols: vi.fn(async () => ({ hits: [] }))
    },
    skills: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => ({
        meta: {
          name: 'stub-skill',
          description: 'stub',
          source: 'bundled' as const,
          rootPath: '/stub',
          skillMdPath: '/stub/SKILL.md'
        },
        raw: '',
        effective: ''
      })),
      create: vi.fn(async (_workspaceId: string, skillName: string) => ({
        meta: {
          name: skillName,
          description: 'stub',
          source: 'workspace' as const,
          rootPath: '/stub',
          skillMdPath: '/stub/SKILL.md'
        },
        path: '/stub/SKILL.md'
      })),
      reveal: vi.fn(async () => ({ ok: true as const })),
      writeOverride: vi.fn(async () => ({ ok: true as const })),
      resetOverride: vi.fn(async () => ({ ok: true as const }))
    },
    attachments: {
      ingestPaths: vi.fn(async () => ({ attachments: [] })),
      remove: asyncNoop
    },
    capture: {
      ingestFrame: vi.fn(async () => ({ path: '/stub/capture.jpg' })),
      requestFrame: vi.fn(async () => null)
    },
    conversations: {
      list: vi.fn(async () => []),
      read: vi.fn(async () => null),
      readTail: vi.fn(async () => null),
      readBefore: vi.fn(async () => ({ events: [], hasOlder: false })),
      search: vi.fn(async () => []),
      export: vi.fn(async () => ({ canceled: true })),
      create: vi.fn(async () => ({ id: 'new', title: 'Untitled', updatedAt: 0 })),
      rename: asyncNoop,
      remove: asyncNoop,
      move: vi.fn(async () => ({ id: 'new', title: 'Untitled', updatedAt: 0 }))
    },
    scheduledRuns: {
      list: vi.fn(async () => []),
      upsert: vi.fn(async (input) => ({ ...input, id: 'sched-1', createdAt: 0, updatedAt: 0 })),
      delete: vi.fn(async () => ({ ok: true })),
      onUpdated: subscribe
    },
    github: {
      listAccounts: vi.fn(async () => []),
      startDeviceFlow: vi.fn(async () => ({
        deviceCode: 'dc',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5
      })),
      pollDeviceFlow: vi.fn(async () => ({ status: 'pending' as const })),
      addPat: vi.fn(async () => ({
        id: 'gh-1',
        login: 'user',
        name: null,
        avatarUrl: null,
        host: 'github.com',
        authKind: 'pat' as const,
        addedAt: 0
      })),
      removeAccount: vi.fn(async () => ({ ok: true })),
      verifyAccount: vi.fn(async () => ({
        id: 'gh-1',
        login: 'user',
        name: null,
        avatarUrl: null,
        host: 'github.com',
        authKind: 'pat' as const,
        addedAt: 0,
        lastVerifiedAt: Date.now(),
        verifyStatus: 'ok' as const
      })),
      isOAuthConfigured: vi.fn(async () => false),
      e2eSeed: vi.fn(async () => ({ accountId: 'gh-e2e' })),
      e2eBindWorkspace: vi.fn(async () => ({ id: 'ws-e2e', path: '/tmp', label: 'e2e' })),
      listRepos: vi.fn(async () => []),
      listOrgs: vi.fn(async () => []),
      listRecentRepos: vi.fn(async () => []),
      getCloneState: vi.fn(async () => ({ state: 'absent' as const, path: '/tmp/repo' })),
      listBranches: vi.fn(async () => []),
      openRepo: vi.fn(async () => ({ id: 'ws-gh', path: '/tmp/repo', label: 'o/r', addedAt: 0 })),
      onGitProgress: vi.fn(() => () => {})
    },
    tools: {
      openPath: asyncNoop,
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
        settingsFile: '/tmp/userdata/vyotiq/settings.json',
        logDir: '/tmp/userdata/vyotiq/logs'
      })),
      revealPath: asyncNoop,
      playWarningSound: vi.fn(async () => undefined),
      setThemeSource: asyncNoop,
      checkForUpdates: vi.fn(async () => ({
        updateAvailable: false,
        status: { phase: 'idle' as const }
      })),
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
        { id: 'orchestrator-core', file: '00-orchestrator-core.md', hasOverride: false, placement: 'prefix' },
        { id: 'context-learning', file: '01-context-learning.md', hasOverride: false, placement: 'prefix' },
        { id: 'dynamic-loop', file: '05-dynamic-loop.md', hasOverride: false, placement: 'prefix' }
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
      read: vi.fn(async () => ({
        content: '',
        mtimeMs: 0,
        truncated: false,
        eol: 'lf' as const,
        encoding: 'utf-8' as const,
        utf8Bom: false
      })),
      write: vi.fn(async () => ({ ok: true as const, mtimeMs: 0 }))
    },
    terminal: {
      attach: vi.fn(async () => ({ ok: true as const, sessions: [] })),
      create: vi.fn(async () => ({
        ok: true as const,
        session: {
          sessionId: 's-stub',
          workspaceId: 'ws-stub',
          shell: 'bash',
          cols: 80,
          rows: 24,
          primary: false
        }
      })),
      list: vi.fn(async () => ({ sessions: [] })),
      close: asyncNoop,
      input: asyncNoop,
      resize: asyncNoop,
      restart: vi.fn(async () => ({
        ok: true as const,
        session: {
          sessionId: 's-stub',
          workspaceId: 'ws-stub',
          shell: 'bash',
          cols: 80,
          rows: 24,
          primary: true
        }
      })),
      detach: asyncNoop,
      onData: subscribe,
      onExit: subscribe
    },
    browser: {
      attach: vi.fn(async () => ({
        ok: true as const,
        state: {
          url: '',
          title: '',
          loading: false,
          canGoBack: false,
          canGoForward: false
        }
      })),
      navigate: asyncNoop,
      back: asyncNoop,
      forward: asyncNoop,
      reload: asyncNoop,
      stop: asyncNoop,
      setBounds: asyncNoop,
      setVisible: asyncNoop,
      find: asyncNoop,
      stopFind: asyncNoop,
      openExternal: asyncNoop,
      destroy: asyncNoop,
      onState: subscribe
    },
    completion: {
      request: vi.fn(async (input: { requestId: number }) => ({ requestId: input.requestId, text: '' })),
      cancel: asyncNoop
    },
    lsp: {
      connect: vi.fn(async () => ({
        ok: false,
        rootUri: '',
        status: { connected: false, pid: null, lastError: null },
        configSource: 'disabled' as const
      })),
      send: asyncNoop,
      status: vi.fn(async () => ({
        ok: false,
        rootUri: '',
        status: { connected: false, pid: null, lastError: null },
        configSource: 'disabled' as const
      })),
      disconnect: asyncNoop,
      onMessage: subscribe
    },
    mentions: {
      searchSymbols: vi.fn(async () => ({ hits: [] }))
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
