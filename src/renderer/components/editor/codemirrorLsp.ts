/**
 * CodeMirror @codemirror/lsp-client integration.
 */

import type { Extension } from '@codemirror/state';
import { jumpToDefinitionKeymap, type LSPClient as LSPClientType } from '@codemirror/lsp-client';
import { keymap } from '@codemirror/view';
import { fileUriForWorkspace } from '../../lib/lspWorkspaceClient.js';
import { languageIdForPath } from '@shared/text/languageFromPath.js';
import { lspCodeActionExtensions } from './codemirrorLspCodeActions.js';

export interface LspEditorBridge {
  workspaceId: string;
  filePath: string;
  rootUri: string;
  client: LSPClientType;
}

/** Build LSP extensions once client is connected. */
export function lspClientExtensions(bridge: LspEditorBridge | null): Extension[] {
  if (!bridge) return [];

  const uri = fileUriForWorkspace(bridge.rootUri, bridge.filePath);
  const languageId = languageIdForPath(bridge.filePath);
  return [
    bridge.client.plugin(uri, languageId),
    keymap.of(jumpToDefinitionKeymap),
    ...lspCodeActionExtensions()
  ];
}
