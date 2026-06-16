/**
 * LSP IPC — relay bridge for @codemirror/lsp-client in the editor.
 */

import { IPC } from '@shared/constants.js';
import {
  lspConnect,
  lspDisconnect,
  lspGetStatus,
  lspSendMessage,
  type LspConnectInput
} from '../lsp/lspManager.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertObject, assertString } from './validate.js';

export function registerLspIpc(): void {
  wrapIpcHandler(
    IPC.LSP_CONNECT,
    async (_event, input: LspConnectInput) => {
      assertObject('lsp:connect', 'input', input);
      assertString('lsp:connect', 'input.workspaceId', input.workspaceId);
      if (input.languageId !== undefined && input.languageId !== null) {
        assertString('lsp:connect', 'input.languageId', input.languageId, { nonEmpty: false });
      }
      return lspConnect(input);
    }
  );

  wrapIpcHandler(
    IPC.LSP_SEND,
    async (_event, input: { workspaceId: string; message: string }) => {
      assertObject('lsp:send', 'input', input);
      assertString('lsp:send', 'input.workspaceId', input.workspaceId);
      assertString('lsp:send', 'input.message', input.message, {
        nonEmpty: true,
        maxBytes: 256 * 1024
      });
      lspSendMessage(input.workspaceId, input.message);
      return { ok: true as const };
    }
  );

  wrapIpcHandler(
    IPC.LSP_STATUS,
    async (_event, input: LspConnectInput) => {
      assertObject('lsp:status', 'input', input);
      assertString('lsp:status', 'input.workspaceId', input.workspaceId);
      if (input.languageId !== undefined && input.languageId !== null) {
        assertString('lsp:status', 'input.languageId', input.languageId, { nonEmpty: false });
      }
      return lspGetStatus(input);
    }
  );

  wrapIpcHandler(
    IPC.LSP_DISCONNECT,
    async (_event, input: { workspaceId: string }) => {
      assertObject('lsp:disconnect', 'input', input);
      assertString('lsp:disconnect', 'input.workspaceId', input.workspaceId);
      await lspDisconnect(input.workspaceId);
      return { ok: true as const };
    }
  );
}
