/**
 * Per-workspace LSP session manager — relay mode for @codemirror/lsp-client.
 */

import { pathToFileURL } from 'node:url';
import { BrowserWindow } from 'electron';
import { IPC } from '@shared/constants.js';
import { languageIdForPath } from '@shared/text/languageFromPath.js';
import { LspSession, type LspDiagnostic, type LspCompletionItem } from './lspSession.js';
import { LspRelaySession, type LspRelayStatus } from './lspRelaySession.js';
import { mergeLspConfig, readWorkspaceLspOverride } from './lspWorkspaceConfig.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { getSettings } from '../settings/settingsStore.js';

const legacySessions = new Map<string, LspSession>();
const relaySessions = new Map<string, LspRelaySession>();
const relayUnsubs = new Map<string, () => void>();
const pendingDiagListeners = new Map<string, Set<(path: string, diags: LspDiagnostic[]) => void>>();

export interface LspConnectResult {
  ok: boolean;
  rootUri: string;
  status: LspRelayStatus;
  configSource: 'global' | 'workspace' | 'disabled';
  reason?: string;
}

async function resolveLspConfig(workspaceId: string) {
  const settings = await getSettings();
  const workspacePath = await requireWorkspaceById(workspaceId);
  const override = await readWorkspaceLspOverride(workspacePath);
  const merged = mergeLspConfig(settings.ui?.editorLsp, override);
  return { workspacePath, merged };
}

function pushRelayMessage(workspaceId: string, message: string): void {
  const payload = { workspaceId, message };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.LSP_MESSAGE, payload);
  }
}

export async function lspConnect(workspaceId: string): Promise<LspConnectResult> {
  const { workspacePath, merged } = await resolveLspConfig(workspaceId);
  const rootUri = pathToFileURL(workspacePath).href;

  if (!merged.enabled || !merged.command) {
    return {
      ok: false,
      rootUri,
      status: { connected: false, pid: null, lastError: 'LSP disabled or command not set' },
      configSource: merged.source,
      reason: 'LSP disabled or command not set'
    };
  }

  let relay = relaySessions.get(workspaceId);
  if (!relay) {
    relay = new LspRelaySession(merged.command, merged.args, workspacePath);
    relaySessions.set(workspaceId, relay);
    const unsub = relay.onMessage((message) => pushRelayMessage(workspaceId, message));
    relayUnsubs.set(workspaceId, unsub);
    await relay.start();
  }

  return {
    ok: true,
    rootUri,
    status: relay.getStatus(),
    configSource: merged.source
  };
}

export function lspSendMessage(workspaceId: string, message: string): void {
  const relay = relaySessions.get(workspaceId);
  relay?.send(message);
}

export async function lspGetStatus(workspaceId: string): Promise<LspConnectResult> {
  const { workspacePath, merged } = await resolveLspConfig(workspaceId);
  const rootUri = pathToFileURL(workspacePath).href;
  const relay = relaySessions.get(workspaceId);
  return {
    ok: relay != null && relay.getStatus().connected,
    rootUri,
    status: relay?.getStatus() ?? {
      connected: false,
      pid: null,
      lastError: merged.enabled ? null : 'LSP disabled'
    },
    configSource: merged.source
  };
}

async function ensureLegacySession(workspaceId: string): Promise<LspSession | null> {
  const { merged, workspacePath } = await resolveLspConfig(workspaceId);
  if (!merged.enabled || !merged.command) return null;

  let session = legacySessions.get(workspaceId);
  if (session) return session;

  session = new LspSession(merged.command, merged.args);
  const listeners = pendingDiagListeners.get(workspaceId);
  if (listeners) {
    for (const listener of listeners) {
      session.onDiagnostics(listener);
    }
  }
  await session.start(workspacePath);
  legacySessions.set(workspaceId, session);
  return session;
}

export async function lspOpenDocument(
  workspaceId: string,
  relPath: string,
  text: string
): Promise<void> {
  const session = await ensureLegacySession(workspaceId);
  if (!session) return;
  await session.openDocument(relPath, languageIdForPath(relPath), text);
}

export async function lspChangeDocument(
  workspaceId: string,
  relPath: string,
  text: string
): Promise<void> {
  const session = legacySessions.get(workspaceId);
  if (!session) return;
  await session.changeDocument(relPath, text);
}

export async function lspCloseDocument(workspaceId: string, relPath: string): Promise<void> {
  const session = legacySessions.get(workspaceId);
  if (!session) return;
  await session.closeDocument(relPath);
}

export async function lspDefinition(
  workspaceId: string,
  relPath: string,
  line: number,
  character: number
) {
  const session = legacySessions.get(workspaceId);
  if (!session) return null;
  return session.definition(relPath, line, character);
}

export async function lspHover(
  workspaceId: string,
  relPath: string,
  line: number,
  character: number
): Promise<string | null> {
  const session = legacySessions.get(workspaceId);
  if (!session) return null;
  return session.hover(relPath, line, character);
}

export async function lspCompletion(
  workspaceId: string,
  relPath: string,
  line: number,
  character: number
): Promise<LspCompletionItem[]> {
  const session = legacySessions.get(workspaceId);
  if (!session) return [];
  return session.completion(relPath, line, character);
}

export function subscribeLspDiagnostics(
  workspaceId: string,
  listener: (path: string, diags: LspDiagnostic[]) => void
): () => void {
  let set = pendingDiagListeners.get(workspaceId);
  if (!set) {
    set = new Set();
    pendingDiagListeners.set(workspaceId, set);
  }
  set.add(listener);
  const session = legacySessions.get(workspaceId);
  if (session) {
    const unsub = session.onDiagnostics(listener);
    return () => {
      unsub();
      set?.delete(listener);
    };
  }
  return () => {
    set?.delete(listener);
  };
}

export async function disposeLspSession(workspaceId: string): Promise<void> {
  const legacy = legacySessions.get(workspaceId);
  if (legacy) {
    await legacy.stop();
    legacySessions.delete(workspaceId);
  }
  const relay = relaySessions.get(workspaceId);
  if (relay) {
    relayUnsubs.get(workspaceId)?.();
    relayUnsubs.delete(workspaceId);
    await relay.stop();
    relaySessions.delete(workspaceId);
  }
  pendingDiagListeners.delete(workspaceId);
}
