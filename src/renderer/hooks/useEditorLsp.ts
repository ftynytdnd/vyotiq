/**
 * Wire editor buffers to the main-process LSP relay + @codemirror/lsp-client.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LspLocation } from '@shared/types/lsp.js';
import { resolveEditorLspSettings } from '@shared/settings/editorLspSettings.js';
import { openWorkspaceFileInEditor } from '../lib/openWorkspaceFileInEditor.js';
import {
  disposeLspClient,
  ensureLspClient,
  fetchLspStatus,
  fileUriForWorkspace,
  invalidateLspClients,
  languageIdForLspFile,
  relPathFromFileUri,
  type WorkspaceLspEntry
} from '../lib/lspWorkspaceClient.js';
import { useEditorStore } from '../store/useEditorStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';
import type { LspEditorBridge } from '../components/editor/codemirrorLsp.js';

export interface UseEditorLspInput {
  enabled: boolean;
  filePath: string | null;
  workspaceId: string | null;
}

export interface LspConnectionStatus {
  connected: boolean;
  pid: number | null;
  lastError: string | null;
  configSource: 'global' | 'workspace' | 'disabled' | 'bundled';
}

function lspSettingsFingerprint(
  editorLsp: NonNullable<ReturnType<typeof useSettingsStore.getState>['settings']['ui']>['editorLsp']
): string {
  const resolved = resolveEditorLspSettings(
    editorLsp ? { editorLsp } : undefined
  );
  return JSON.stringify({
    enabled: resolved.enabled,
    command: resolved.command ?? '',
    args: resolved.args ?? [],
    languages: resolved.languages ?? {}
  });
}

function statusFromPoll(
  st: Awaited<ReturnType<typeof fetchLspStatus>>
): LspConnectionStatus {
  return {
    connected: st.status.connected,
    pid: st.status.pid,
    lastError: st.reason ?? st.status.lastError,
    configSource: st.configSource
  };
}

export function useEditorLsp(input: UseEditorLspInput) {
  const { enabled, filePath, workspaceId } = input;
  const languageId = languageIdForLspFile(filePath);
  const editorActive = Boolean(filePath);
  const editorLsp = useSettingsStore((s) => s.settings.ui?.editorLsp);
  const lspConfigKey = useMemo(() => lspSettingsFingerprint(editorLsp), [editorLsp]);
  const workspaceKnown = useWorkspaceStore((s) =>
    workspaceId != null && s.list.some((workspace) => workspace.id === workspaceId)
  );
  const [entry, setEntry] = useState<WorkspaceLspEntry | null>(null);
  const [status, setStatus] = useState<LspConnectionStatus | null>(null);
  const reconnectingRef = useRef(false);

  useEffect(() => {
    if (!enabled || !workspaceId || !workspaceKnown || !editorActive) {
      if (!enabled && workspaceId) {
        invalidateLspClients(workspaceId);
      }
      setEntry(null);
      setStatus(null);
      return;
    }

    let cancelled = false;

    const connect = async (): Promise<WorkspaceLspEntry | null> => {
      const clientEntry = await ensureLspClient(workspaceId, languageId);
      if (cancelled) {
        if (clientEntry) disposeLspClient(workspaceId, languageId);
        return null;
      }
      setEntry(clientEntry);
      const st = await fetchLspStatus(workspaceId, languageId).catch(() => null);
      if (cancelled) return clientEntry;
      if (!st) {
        setStatus({
          connected: false,
          pid: null,
          lastError: 'Could not connect',
          configSource: 'disabled'
        });
        return clientEntry;
      }
      setStatus(statusFromPoll(st));
      return clientEntry;
    };

    void connect().then((clientEntry) => {
      if (cancelled || clientEntry) return;
      void fetchLspStatus(workspaceId, languageId)
        .then((st) => {
          if (cancelled) return;
          setStatus({
            connected: false,
            pid: st.status.pid,
            lastError: st.reason ?? st.status.lastError ?? 'Could not connect',
            configSource: st.configSource
          });
        })
        .catch(() => {
          if (cancelled) return;
          setStatus({
            connected: false,
            pid: null,
            lastError: 'Could not connect',
            configSource: 'disabled'
          });
        });
    });

    const interval = window.setInterval(() => {
      void fetchLspStatus(workspaceId, languageId)
        .then(async (st) => {
          if (cancelled) return;
          setStatus(statusFromPoll(st));
          if (st.status.connected || reconnectingRef.current) return;
          reconnectingRef.current = true;
          disposeLspClient(workspaceId, languageId);
          try {
            const clientEntry = await ensureLspClient(workspaceId, languageId);
            if (cancelled) {
              if (clientEntry) disposeLspClient(workspaceId, languageId);
              return;
            }
            setEntry(clientEntry);
            const next = await fetchLspStatus(workspaceId, languageId).catch(() => null);
            if (!cancelled && next) setStatus(statusFromPoll(next));
          } finally {
            reconnectingRef.current = false;
          }
        })
        .catch(() => {
          if (cancelled) return;
          setStatus(null);
        });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      disposeLspClient(workspaceId, languageId);
    };
  }, [enabled, workspaceId, workspaceKnown, editorActive, languageId, lspConfigKey]);

  const bridge: LspEditorBridge | null =
    enabled && filePath && workspaceId && workspaceKnown && entry
      ? {
          workspaceId,
          filePath,
          rootUri: entry.rootUri,
          client: entry.client
        }
      : null;

  const goToDefinition = useCallback(
    async (line: number, character: number) => {
      if (!enabled || !filePath || !workspaceId || !entry) return;
      const uri = fileUriForWorkspace(entry.rootUri, filePath);
      try {
        const result = await entry.client.request('textDocument/definition', {
          textDocument: { uri },
          position: { line, character }
        });
        const loc = Array.isArray(result) ? result[0] : result;
        if (!loc || typeof loc !== 'object') return;
        const targetUri = (loc as { uri?: string }).uri;
        const range = (loc as { range?: { start?: { line?: number; character?: number } } }).range;
        if (!targetUri || !range?.start) return;
        const rel = relPathFromFileUri(entry.rootUri, targetUri);
        if (!rel) return;
        const location: LspLocation = {
          filePath: rel,
          line: range.start.line ?? 0,
          character: range.start.character ?? 0
        };
        await openWorkspaceFileInEditor(location.filePath, { workspaceId });
        useEditorStore.getState().setActiveTab(location.filePath);
        useEditorStore.getState().requestReveal(location.filePath, location.line, location.character);
      } catch {
        /* noop */
      }
    },
    [enabled, filePath, workspaceId, entry]
  );

  return { bridge, goToDefinition, status, diagnostics: [] as never[] };
}
