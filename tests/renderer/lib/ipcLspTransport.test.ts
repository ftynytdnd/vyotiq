/**
 * IPC LSP transport — one relay subscription per workspace.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const onMessageMock = vi.hoisted(() => vi.fn(() => () => undefined));
const sendMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    lsp: {
      send: sendMock,
      onMessage: onMessageMock
    }
  }
}));

describe('createIpcLspTransport', () => {
  beforeEach(() => {
    onMessageMock.mockClear();
    sendMock.mockClear();
    vi.resetModules();
  });

  it('reuses one transport and one IPC listener per workspace', async () => {
    const { createIpcLspTransport } = await import('@renderer/lib/ipcLspTransport.js');
    const a = createIpcLspTransport('ws-1');
    const b = createIpcLspTransport('ws-1');
    expect(a).toBe(b);

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    a.subscribe(handlerA);
    b.subscribe(handlerB);
    expect(onMessageMock).toHaveBeenCalledTimes(1);

    const relay = onMessageMock.mock.calls[0]![0] as (event: {
      workspaceId: string;
      message: string;
    }) => void;
    relay({ workspaceId: 'ws-1', message: '{"jsonrpc":"2.0"}' });
    expect(handlerA).toHaveBeenCalledWith('{"jsonrpc":"2.0"}');
    expect(handlerB).toHaveBeenCalledWith('{"jsonrpc":"2.0"}');

    a.unsubscribe(handlerA);
    expect(onMessageMock).not.toHaveBeenCalledTimes(2);

    b.unsubscribe(handlerB);
    expect(onMessageMock.mock.results[0]?.value).toEqual(expect.any(Function));
  });

  it('creates separate transports for different workspaces', async () => {
    const { createIpcLspTransport } = await import('@renderer/lib/ipcLspTransport.js');
    const a = createIpcLspTransport('ws-a');
    const b = createIpcLspTransport('ws-b');
    expect(a).not.toBe(b);

    a.subscribe(vi.fn());
    b.subscribe(vi.fn());
    expect(onMessageMock).toHaveBeenCalledTimes(2);
  });
});
