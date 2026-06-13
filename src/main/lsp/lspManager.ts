/**
 * Per-workspace LSP session manager.
 */

import { LspSession, type LspDiagnostic } from './lspSession.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { getSettings } from '../settings/settingsStore.js';
import { languageIdForPath } from '@shared/text/languageFromPath.js';

const sessions = new Map<string, LspSession>();
const pendingDiagListeners = new Map<string, Set<(path: string, diags: LspDiagnostic[]) => void>>();

async function ensureSession(workspaceId: string): Promise<LspSession | null> {
  const settings = await getSettings();
  const lsp = settings.ui?.editorLsp;
  if (!lsp?.enabled || !lsp.command?.trim()) return null;

  let session = sessions.get(workspaceId);
  if (session) return session;

  const workspacePath = await requireWorkspaceById(workspaceId);
  session = new LspSession(lsp.command.trim(), Array.isArray(lsp.args) ? lsp.args : ['--stdio']);
  const listeners = pendingDiagListeners.get(workspaceId);
  if (listeners) {
    for (const listener of listeners) {
      session.onDiagnostics(listener);
    }
  }
  await session.start(workspacePath);
  sessions.set(workspaceId, session);
  return session;
}

export async function lspOpenDocument(
  workspaceId: string,
  relPath: string,
  text: string
): Promise<void> {
  const session = await ensureSession(workspaceId);
  if (!session) return;
  await session.openDocument(relPath, languageIdForPath(relPath), text);
}

export async function lspChangeDocument(
  workspaceId: string,
  relPath: string,
  text: string
): Promise<void> {
  const session = await ensureSession(workspaceId);
  if (!session) return;
  await session.changeDocument(relPath, text);
}

export async function lspCloseDocument(workspaceId: string, relPath: string): Promise<void> {
  const session = sessions.get(workspaceId);
  if (!session) return;
  await session.closeDocument(relPath);
}

export async function lspDefinition(
  workspaceId: string,
  relPath: string,
  line: number,
  character: number
) {
  const session = sessions.get(workspaceId);
  if (!session) return null;
  return session.definition(relPath, line, character);
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
  const session = sessions.get(workspaceId);
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
  const session = sessions.get(workspaceId);
  if (!session) return;
  await session.stop();
  sessions.delete(workspaceId);
  pendingDiagListeners.delete(workspaceId);
}
