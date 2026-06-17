/**
 * Per-workspace LSP session manager — relay mode for @codemirror/lsp-client.
 */

import { pathToFileURL } from 'node:url';
import { IPC } from '@shared/constants.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { LspRelaySession, type LspRelayStatus } from './lspRelaySession.js';
import {
  mergeLspConfig,
  readWorkspaceLspOverride,
  relayFingerprint,
  resolveLspServerForLanguage,
  type ResolvedLspConfig,
  type ResolvedLspServerConfig
} from './lspWorkspaceConfig.js';
import { autoDetectLspServer } from './lspCommandResolve.js';
import { resolveBundledLspServer } from './bundledLspServers.js';
import { listWorkspaces } from '../workspace/workspaceState.js';
import { getSettings } from '../settings/settingsStore.js';

const relaySessions = new Map<string, LspRelaySession>();
const relayUnsubs = new Map<string, () => void>();
/** Active relay fingerprint per workspace — one stdio server at a time. */
const activeRelayKeyByWorkspace = new Map<string, string>();

export interface LspConnectInput {
  workspaceId: string;
  languageId?: string | null;
}

export interface LspConnectResult {
  ok: boolean;
  rootUri: string;
  status: LspRelayStatus;
  configSource: 'global' | 'workspace' | 'disabled' | 'bundled';
  languageId?: string;
  reason?: string;
}

function workspaceMissingResult(): LspConnectResult {
  return {
    ok: false,
    rootUri: '',
    status: { connected: false, pid: null, lastError: null },
    configSource: 'disabled',
    reason: 'unknown_workspace'
  };
}

function relayMapKey(workspaceId: string, fingerprint: string): string {
  return `${workspaceId}\0${fingerprint}`;
}

async function resolveLspConfig(workspaceId: string) {
  const settings = await getSettings();
  const state = await listWorkspaces();
  const entry = state.workspaces.find((workspace) => workspace.id === workspaceId);
  if (!entry) return null;
  const override = await readWorkspaceLspOverride(entry.path);
  const merged = mergeLspConfig(settings.ui?.editorLsp, override);
  return { workspacePath: entry.path, merged };
}

function pushRelayMessage(workspaceId: string, message: string): void {
  safeWebContentsSend(IPC.LSP_MESSAGE, { workspaceId, message });
}

async function stopRelayByKey(key: string): Promise<void> {
  const relay = relaySessions.get(key);
  if (!relay) return;
  relayUnsubs.get(key)?.();
  relayUnsubs.delete(key);
  await relay.stop();
  relaySessions.delete(key);
}

async function stopWorkspaceRelays(workspaceId: string): Promise<void> {
  const keys = [...relaySessions.keys()].filter((key) => key.startsWith(`${workspaceId}\0`));
  for (const key of keys) {
    await stopRelayByKey(key);
  }
  activeRelayKeyByWorkspace.delete(workspaceId);
}

async function ensureRelay(
  workspaceId: string,
  workspacePath: string,
  server: ResolvedLspServerConfig
): Promise<LspRelaySession> {
  const fingerprint = relayFingerprint(server);
  const key = relayMapKey(workspaceId, fingerprint);
  const activeKey = activeRelayKeyByWorkspace.get(workspaceId);

  if (activeKey && activeKey !== key) {
    await stopRelayByKey(activeKey);
  }

  let relay = relaySessions.get(key);
  if (!relay) {
    relay = new LspRelaySession(server, workspacePath);
    relaySessions.set(key, relay);
    const unsub = relay.onMessage((message) => pushRelayMessage(workspaceId, message));
    relayUnsubs.set(key, unsub);
  }

  await relay.start();
  activeRelayKeyByWorkspace.set(workspaceId, key);
  return relay;
}

function activeRelayForWorkspace(workspaceId: string): LspRelaySession | null {
  const key = activeRelayKeyByWorkspace.get(workspaceId);
  if (!key) return null;
  return relaySessions.get(key) ?? null;
}

function configSourceForServer(
  merged: ResolvedLspConfig,
  server: ResolvedLspServerConfig
): LspConnectResult['configSource'] {
  if (server.bundledId) return 'bundled';
  return merged.source;
}

async function resolveServerConfig(
  merged: ResolvedLspConfig,
  languageId?: string | null
): Promise<{ server: ResolvedLspServerConfig | null; reason?: string }> {
  const configured = resolveLspServerForLanguage(merged, languageId);
  if (configured) return { server: configured };

  if (!merged.enabled) return { server: null, reason: 'LSP disabled' };

  const lang = (languageId ?? '').trim().toLowerCase();
  if (lang && lang !== 'plaintext') {
    const bundled = resolveBundledLspServer(lang);
    if (bundled) return { server: bundled };

    const detected = await autoDetectLspServer(lang);
    if (detected) return { server: detected };
  }

  if (!merged.command && Object.keys(merged.languages).length === 0) {
    return {
      server: null,
      reason:
        lang && lang !== 'plaintext'
          ? `No built-in or custom language server for ${lang} — add an override in Settings → Editor LSP`
          : 'Open a supported file (Python, TypeScript, or JavaScript) to start the built-in language server'
    };
  }

  return { server: null, reason: 'LSP disabled or command not set' };
}

export async function lspConnect(input: LspConnectInput): Promise<LspConnectResult> {
  const { workspaceId, languageId } = input;
  const resolved = await resolveLspConfig(workspaceId);
  if (!resolved) return workspaceMissingResult();
  const { workspacePath, merged } = resolved;
  const rootUri = pathToFileURL(workspacePath).href;

  const { server, reason } = await resolveServerConfig(merged, languageId);
  if (!server) {
    return {
      ok: false,
      rootUri,
      status: { connected: false, pid: null, lastError: reason ?? null },
      configSource: merged.source,
      reason: reason ?? 'LSP disabled or command not set'
    };
  }

  const relay = await ensureRelay(workspaceId, workspacePath, server);
  const status = relay.getStatus();
  if (!status.connected) {
    return {
      ok: false,
      rootUri,
      status,
      configSource: configSourceForServer(merged, server),
      languageId: languageId ?? undefined,
      reason: status.lastError ?? 'Failed to start language server'
    };
  }

  return {
    ok: true,
    rootUri,
    status,
    configSource: configSourceForServer(merged, server),
    languageId: languageId ?? undefined
  };
}

export function lspSendMessage(workspaceId: string, message: string): void {
  const relay = activeRelayForWorkspace(workspaceId);
  relay?.send(message);
}

export async function lspGetStatus(input: LspConnectInput): Promise<LspConnectResult> {
  const { workspaceId, languageId } = input;
  const resolved = await resolveLspConfig(workspaceId);
  if (!resolved) return workspaceMissingResult();
  const { workspacePath, merged } = resolved;
  const rootUri = pathToFileURL(workspacePath).href;
  const { server, reason } = await resolveServerConfig(merged, languageId);
  if (!server) {
    return {
      ok: false,
      rootUri,
      status: { connected: false, pid: null, lastError: reason ?? 'LSP disabled' },
      configSource: merged.source,
      reason
    };
  }

  const fingerprint = relayFingerprint(server);
  const key = relayMapKey(workspaceId, fingerprint);
  const relay = relaySessions.get(key);
  const status = relay?.getStatus() ?? {
    connected: false,
    pid: null,
    lastError: null
  };
  return {
    ok: status.connected,
    rootUri,
    status,
    configSource: configSourceForServer(merged, server),
    languageId: languageId ?? undefined
  };
}

export async function lspDisconnect(workspaceId: string): Promise<void> {
  await stopWorkspaceRelays(workspaceId);
}

export async function lspDisconnectAll(): Promise<void> {
  const workspaceIds = new Set<string>();
  for (const key of relaySessions.keys()) {
    workspaceIds.add(key.split('\0')[0]!);
  }
  for (const workspaceId of workspaceIds) {
    await stopWorkspaceRelays(workspaceId);
  }
}

/** Workspace teardown — stops relay sessions for the given workspace. */
export async function disposeLspSession(workspaceId: string): Promise<void> {
  await lspDisconnect(workspaceId);
}
