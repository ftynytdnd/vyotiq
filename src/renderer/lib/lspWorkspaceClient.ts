/**
 * Shared LSPClient per workspace — connects via main-process stdio relay.
 */

import {
  LSPClient,
  languageServerExtensions,
  type LSPClient as LSPClientType
} from '@codemirror/lsp-client';
import { createIpcLspTransport } from './ipcLspTransport.js';
import { sanitizeLspHtml } from './lspSanitize.js';
import { vyotiq } from './ipc.js';
import { VyotiqLspWorkspace } from './vyotiqLspWorkspace.js';

export interface WorkspaceLspEntry {
  client: LSPClientType;
  rootUri: string;
  ready: Promise<void>;
}

const clients = new Map<string, WorkspaceLspEntry>();

export function fileUriForWorkspace(rootUri: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const base = rootUri.endsWith('/') ? rootUri.slice(0, -1) : rootUri;
  const segments = normalized.split('/').map((s) => encodeURIComponent(s));
  return `${base}/${segments.join('/')}`;
}

export function relPathFromFileUri(rootUri: string, uri: string): string | null {
  const base = rootUri.endsWith('/') ? rootUri : `${rootUri}/`;
  if (!uri.startsWith(base)) return null;
  const tail = uri.slice(base.length);
  try {
    return decodeURIComponent(tail).replace(/\\/g, '/');
  } catch {
    return tail.replace(/\\/g, '/');
  }
}

export async function ensureLspClient(workspaceId: string): Promise<WorkspaceLspEntry | null> {
  const existing = clients.get(workspaceId);
  if (existing) return existing;

  const connect = await vyotiq.lsp.connect({ workspaceId });
  if (!connect.ok) return null;

  const transport = createIpcLspTransport(workspaceId);
  const client = new LSPClient({
    rootUri: connect.rootUri,
    timeout: 15_000,
    sanitizeHTML: sanitizeLspHtml,
    workspace: (c) => new VyotiqLspWorkspace(c, workspaceId, connect.rootUri),
    extensions: languageServerExtensions()
  }).connect(transport);

  const entry: WorkspaceLspEntry = {
    client,
    rootUri: connect.rootUri,
    ready: client.initializing.then(() => undefined)
  };
  clients.set(workspaceId, entry);
  await entry.ready;
  return entry;
}

export async function getLspClient(workspaceId: string): Promise<WorkspaceLspEntry | null> {
  return ensureLspClient(workspaceId);
}

export function disposeLspClient(workspaceId: string): void {
  const entry = clients.get(workspaceId);
  if (!entry) return;
  entry.client.disconnect();
  clients.delete(workspaceId);
}

export async function fetchLspStatus(workspaceId: string) {
  return vyotiq.lsp.status({ workspaceId });
}
