/**
 * IPC-backed Transport for @codemirror/lsp-client.
 *
 * One transport (and one `lsp:onMessage` subscription) per workspace —
 * multiple language clients in the same workspace share the relay.
 */

import type { Transport } from '@codemirror/lsp-client';
import { vyotiq } from './ipc.js';

const transportsByWorkspace = new Map<string, Transport>();

function buildTransport(workspaceId: string): Transport {
  const handlers = new Set<(value: string) => void>();
  let unsub: (() => void) | null = null;

  const transport: Transport = {
    send(message: string) {
      void vyotiq.lsp.send({ workspaceId, message });
    },
    subscribe(handler: (value: string) => void) {
      handlers.add(handler);
      if (!unsub) {
        unsub = vyotiq.lsp.onMessage((event) => {
          if (event.workspaceId !== workspaceId) return;
          for (const h of handlers) h(event.message);
        });
      }
    },
    unsubscribe(handler: (value: string) => void) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        unsub?.();
        unsub = null;
        transportsByWorkspace.delete(workspaceId);
      }
    }
  };

  return transport;
}

export function createIpcLspTransport(workspaceId: string): Transport {
  const existing = transportsByWorkspace.get(workspaceId);
  if (existing) return existing;

  const transport = buildTransport(workspaceId);
  transportsByWorkspace.set(workspaceId, transport);
  return transport;
}
