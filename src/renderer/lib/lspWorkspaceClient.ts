/**
 * Shared LSPClient per workspace + language — connects via main-process stdio relay.
 */

import {
  LSPClient,
  languageServerExtensions,
  type LSPClient as LSPClientType
} from '@codemirror/lsp-client';
import { languageIdForPath } from '@shared/text/languageFromPath.js';
import { createIpcLspTransport } from './ipcLspTransport.js';
import { sanitizeLspHtml } from './lspSanitize.js';
import { vyotiq } from './ipc.js';
import { VyotiqLspWorkspace } from './vyotiqLspWorkspace.js';

export interface WorkspaceLspEntry {
  client: LSPClientType;
  rootUri: string;
  languageId: string;
  ready: Promise<void>;
}

const clients = new Map<string, WorkspaceLspEntry>();

function clientKey(workspaceId: string, languageId: string): string {
  return `${workspaceId}\0${languageId}`;
}

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

export function languageIdForLspFile(filePath: string | null | undefined): string {
  if (!filePath) return 'plaintext';
  return languageIdForPath(filePath);
}

export async function ensureLspClient(
  workspaceId: string,
  languageId: string
): Promise<WorkspaceLspEntry | null> {
  const key = clientKey(workspaceId, languageId);
  const existing = clients.get(key);
  if (existing) {
    const live = await vyotiq.lsp
      .status({ workspaceId, languageId })
      .then((st) => st.status.connected)
      .catch(() => false);
    if (live) return existing;
    disposeLspClient(workspaceId, languageId);
  }

  const connect = await vyotiq.lsp.connect({ workspaceId, languageId });
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
    languageId,
    ready: client.initializing.then(() => undefined)
  };

  try {
    await entry.ready;
  } catch {
    client.disconnect();
    void vyotiq.lsp.disconnect({ workspaceId });
    return null;
  }

  clients.set(key, entry);
  return entry;
}

export function disposeLspClient(workspaceId: string, languageId?: string): void {
  if (languageId) {
    const key = clientKey(workspaceId, languageId);
    const entry = clients.get(key);
    if (!entry) return;
    entry.client.disconnect();
    clients.delete(key);
    if (![...clients.keys()].some((k) => k.startsWith(`${workspaceId}\0`))) {
      void vyotiq.lsp.disconnect({ workspaceId });
    }
    return;
  }

  for (const key of [...clients.keys()]) {
    if (!key.startsWith(`${workspaceId}\0`)) continue;
    const entry = clients.get(key);
    entry?.client.disconnect();
    clients.delete(key);
  }
  void vyotiq.lsp.disconnect({ workspaceId });
}

export async function fetchLspStatus(workspaceId: string, languageId?: string | null) {
  return vyotiq.lsp.status({ workspaceId, languageId: languageId ?? undefined });
}

export function invalidateLspClients(workspaceId: string): void {
  disposeLspClient(workspaceId);
}
