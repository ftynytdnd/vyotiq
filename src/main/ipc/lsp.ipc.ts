/**
 * LSP IPC — editor diagnostics and go-to-definition.
 */

import { BrowserWindow } from 'electron';
import { IPC, LSP_MAX_DOCUMENT_BYTES } from '@shared/constants.js';
import type { LspDiagnostic, LspLocation, LspCompletionItem } from '../lsp/lspSession.js';
import {
  lspChangeDocument,
  lspCloseDocument,
  lspCompletion,
  lspConnect,
  lspDefinition,
  lspGetStatus,
  lspHover,
  lspOpenDocument,
  lspSendMessage,
  subscribeLspDiagnostics
} from '../lsp/lspManager.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertObject, assertString, assertNumber } from './validate.js';

const diagUnsubs = new Map<string, () => void>();

function ensureDiagnosticsSubscription(workspaceId: string): void {
  if (diagUnsubs.has(workspaceId)) return;
  const unsub = subscribeLspDiagnostics(workspaceId, (path, diags: LspDiagnostic[]) => {
    const payload = { workspaceId, path, diagnostics: diags };
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.LSP_DIAGNOSTICS, payload);
    }
  });
  diagUnsubs.set(workspaceId, unsub);
}

export function registerLspIpc(): void {
  wrapIpcHandler(
    IPC.LSP_CONNECT,
    async (_event, input: { workspaceId: string }) => {
      assertObject('lsp:connect', 'input', input);
      assertString('lsp:connect', 'input.workspaceId', input.workspaceId);
      return lspConnect(input.workspaceId);
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
    async (_event, input: { workspaceId: string }) => {
      assertObject('lsp:status', 'input', input);
      assertString('lsp:status', 'input.workspaceId', input.workspaceId);
      return lspGetStatus(input.workspaceId);
    }
  );

  wrapIpcHandler(
    IPC.LSP_OPEN,
    async (
      _event,
      input: { workspaceId: string; path: string; text: string }
    ): Promise<{ ok: true }> => {
      assertObject('lsp:open', 'input', input);
      assertString('lsp:open', 'input.workspaceId', input.workspaceId);
      assertString('lsp:open', 'input.path', input.path);
      assertString('lsp:open', 'input.text', input.text, {
        nonEmpty: false,
        maxBytes: LSP_MAX_DOCUMENT_BYTES
      });
      ensureDiagnosticsSubscription(input.workspaceId);
      await lspOpenDocument(input.workspaceId, input.path, input.text);
      return { ok: true };
    }
  );

  wrapIpcHandler(
    IPC.LSP_CHANGE,
    async (
      _event,
      input: { workspaceId: string; path: string; text: string }
    ): Promise<{ ok: true }> => {
      assertObject('lsp:change', 'input', input);
      assertString('lsp:change', 'input.workspaceId', input.workspaceId);
      assertString('lsp:change', 'input.path', input.path);
      assertString('lsp:change', 'input.text', input.text, {
        nonEmpty: false,
        maxBytes: LSP_MAX_DOCUMENT_BYTES
      });
      await lspChangeDocument(input.workspaceId, input.path, input.text);
      return { ok: true };
    }
  );

  wrapIpcHandler(
    IPC.LSP_CLOSE,
    async (_event, input: { workspaceId: string; path: string }): Promise<{ ok: true }> => {
      assertObject('lsp:close', 'input', input);
      assertString('lsp:close', 'input.workspaceId', input.workspaceId);
      assertString('lsp:close', 'input.path', input.path);
      await lspCloseDocument(input.workspaceId, input.path);
      return { ok: true };
    }
  );

  wrapIpcHandler(
    IPC.LSP_DEFINITION,
    async (
      _event,
      input: { workspaceId: string; path: string; line: number; character: number }
    ): Promise<LspLocation | null> => {
      assertObject('lsp:definition', 'input', input);
      assertString('lsp:definition', 'input.workspaceId', input.workspaceId);
      assertString('lsp:definition', 'input.path', input.path);
      assertNumber('lsp:definition', 'input.line', input.line, { integer: true, min: 0 });
      assertNumber('lsp:definition', 'input.character', input.character, { integer: true, min: 0 });
      return lspDefinition(input.workspaceId, input.path, input.line, input.character);
    }
  );

  wrapIpcHandler(
    IPC.LSP_HOVER,
    async (
      _event,
      input: { workspaceId: string; path: string; line: number; character: number }
    ): Promise<{ contents: string | null }> => {
      assertObject('lsp:hover', 'input', input);
      assertString('lsp:hover', 'input.workspaceId', input.workspaceId);
      assertString('lsp:hover', 'input.path', input.path);
      assertNumber('lsp:hover', 'input.line', input.line, { integer: true, min: 0 });
      assertNumber('lsp:hover', 'input.character', input.character, { integer: true, min: 0 });
      const contents = await lspHover(input.workspaceId, input.path, input.line, input.character);
      return { contents };
    }
  );

  wrapIpcHandler(
    IPC.LSP_COMPLETION,
    async (
      _event,
      input: { workspaceId: string; path: string; line: number; character: number }
    ): Promise<{ items: LspCompletionItem[] }> => {
      assertObject('lsp:completion', 'input', input);
      assertString('lsp:completion', 'input.workspaceId', input.workspaceId);
      assertString('lsp:completion', 'input.path', input.path);
      assertNumber('lsp:completion', 'input.line', input.line, { integer: true, min: 0 });
      assertNumber('lsp:completion', 'input.character', input.character, { integer: true, min: 0 });
      const items = await lspCompletion(
        input.workspaceId,
        input.path,
        input.line,
        input.character
      );
      return { items };
    }
  );
}
