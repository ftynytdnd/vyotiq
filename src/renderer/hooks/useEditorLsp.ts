/**
 * Wire editor buffers to the main-process LSP relay + @codemirror/lsp-client.
 */

import { useCallback, useEffect, useState } from 'react';
import type { LspLocation } from '@shared/types/lsp.js';
import { openWorkspaceFileInEditor } from '../lib/openWorkspaceFileInEditor.js';
import {
  ensureLspClient,
  fetchLspStatus,
  fileUriForWorkspace,
  relPathFromFileUri,
  type WorkspaceLspEntry
} from '../lib/lspWorkspaceClient.js';
import { useEditorStore } from '../store/useEditorStore.js';
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
  configSource: 'global' | 'workspace' | 'disabled';
}

export function useEditorLsp(input: UseEditorLspInput) {
  const { enabled, filePath, workspaceId } = input;
  const [entry, setEntry] = useState<WorkspaceLspEntry | null>(null);
  const [status, setStatus] = useState<LspConnectionStatus | null>(null);

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setEntry(null);
      setStatus(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const clientEntry = await ensureLspClient(workspaceId);
      if (cancelled) return;
      setEntry(clientEntry);
      const st = await fetchLspStatus(workspaceId);
      if (cancelled) return;
      setStatus({
        connected: st.status.connected,
        pid: st.status.pid,
        lastError: st.status.lastError,
        configSource: st.configSource
      });
    })();

    const interval = window.setInterval(() => {
      void fetchLspStatus(workspaceId).then((st) => {
        if (cancelled) return;
        setStatus({
          connected: st.status.connected,
          pid: st.status.pid,
          lastError: st.status.lastError,
          configSource: st.configSource
        });
      });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, workspaceId]);

  const bridge: LspEditorBridge | null =
    enabled && filePath && workspaceId && entry
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
