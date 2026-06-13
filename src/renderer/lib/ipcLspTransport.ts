/**
 * IPC-backed Transport for @codemirror/lsp-client.
 */

import type { Transport } from '@codemirror/lsp-client';
import { vyotiq } from './ipc.js';

export function createIpcLspTransport(workspaceId: string): Transport {
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
      }
    }
  };

  return transport;
}
