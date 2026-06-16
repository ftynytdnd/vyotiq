/**
 * useEditorLsp — reconnect and cleanup behavior.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEditorLsp } from '../../../src/renderer/hooks/useEditorLsp.js';
import { useWorkspaceStore } from '../../../src/renderer/store/useWorkspaceStore.js';
import { useSettingsStore } from '../../../src/renderer/store/useSettingsStore.js';

const connect = vi.fn();
const status = vi.fn();
const disconnect = vi.fn();

vi.mock('../../../src/renderer/lib/ipc.js', () => ({
  vyotiq: {
    lsp: {
      connect: (...args: unknown[]) => connect(...args),
      status: (...args: unknown[]) => status(...args),
      disconnect: (...args: unknown[]) => disconnect(...args),
      send: vi.fn(),
      onMessage: () => () => {}
    }
  }
}));

vi.mock('@codemirror/lsp-client', () => {
  function MockLSPClient(this: {
    connected: boolean;
    initializing: Promise<void>;
    disconnect: ReturnType<typeof vi.fn>;
    plugin: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    connect: (transport: unknown) => unknown;
  }) {
    this.connected = true;
    this.initializing = Promise.resolve();
    this.disconnect = vi.fn();
    this.plugin = vi.fn(() => []);
    this.request = vi.fn();
    this.connect = vi.fn(function (this: typeof this) {
      return this;
    });
  }
  return {
    LSPClient: MockLSPClient,
    languageServerExtensions: () => []
  };
});

vi.mock('../../../src/renderer/lib/vyotiqLspWorkspace.js', () => ({
  VyotiqLspWorkspace: class {}
}));

describe('useEditorLsp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      list: [{ id: 'ws-1', path: '/proj', label: 'proj', addedAt: 0 }],
      activeId: 'ws-1',
      info: { path: '/proj', label: 'proj' },
      loading: false
    });
    useSettingsStore.setState({
      settings: { ui: { editorLsp: { enabled: true, command: 'pyright-langserver', args: ['--stdio'] } } },
      loading: false,
      loadError: null
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('disconnects when LSP is disabled', async () => {
    connect.mockResolvedValue({
      ok: true,
      rootUri: 'file:///proj',
      status: { connected: true, pid: 1, lastError: null },
      configSource: 'global'
    });
    status.mockResolvedValue({
      ok: true,
      rootUri: 'file:///proj',
      status: { connected: true, pid: 1, lastError: null },
      configSource: 'global'
    });

    const { rerender } = renderHook(
      (props: { enabled: boolean }) =>
        useEditorLsp({
          enabled: props.enabled,
          filePath: 'main.py',
          workspaceId: 'ws-1'
        }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(connect).toHaveBeenCalled());

    rerender({ enabled: false });
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith({ workspaceId: 'ws-1' }));
  });

  it('surfaces connect failures in status', async () => {
    connect.mockResolvedValue({
      ok: false,
      rootUri: 'file:///proj',
      status: { connected: false, pid: null, lastError: 'spawn ENOENT' },
      configSource: 'global',
      reason: 'spawn ENOENT'
    });
    status.mockResolvedValue({
      ok: false,
      rootUri: 'file:///proj',
      status: { connected: false, pid: null, lastError: 'spawn ENOENT' },
      configSource: 'global',
      reason: 'spawn ENOENT'
    });

    const { result } = renderHook(() =>
      useEditorLsp({
        enabled: true,
        filePath: 'main.py',
        workspaceId: 'ws-1'
      })
    );

    await waitFor(() => {
      expect(result.current.status?.connected).toBe(false);
      expect(result.current.status?.lastError).toMatch(/ENOENT/);
    });
  });
});
