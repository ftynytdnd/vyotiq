/**
 * Wire editor buffers to the main-process LSP session.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LspDiagnostic, LspLocation } from '@shared/types/lsp.js';
import { vyotiq } from '../lib/ipc.js';
import { openWorkspaceFileInEditor } from '../lib/openWorkspaceFileInEditor.js';
import { useEditorStore } from '../store/useEditorStore.js';

export interface UseEditorLspInput {
  enabled: boolean;
  filePath: string | null;
  workspaceId: string | null;
  content: string;
}

export function useEditorLsp(input: UseEditorLspInput) {
  const { enabled, filePath, workspaceId, content } = input;
  const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>([]);
  const openedRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !filePath || !workspaceId) {
      setDiagnostics([]);
      return;
    }
    const unsub = vyotiq.lsp.onDiagnostics((event) => {
      if (event.workspaceId !== workspaceId) return;
      if (event.path.replace(/\\/g, '/') !== filePath.replace(/\\/g, '/')) return;
      setDiagnostics(event.diagnostics);
    });
    return unsub;
  }, [enabled, filePath, workspaceId]);

  useEffect(() => {
    if (!enabled || !filePath || !workspaceId) return;

    const openKey = `${workspaceId}:${filePath}`;
    if (openedRef.current !== openKey) {
      openedRef.current = openKey;
      void vyotiq.lsp.open({ workspaceId, path: filePath, text: content });
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void vyotiq.lsp.change({ workspaceId, path: filePath, text: content });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, filePath, workspaceId, content]);

  useEffect(() => {
    return () => {
      if (!enabled || !filePath || !workspaceId) return;
      void vyotiq.lsp.close({ workspaceId, path: filePath });
    };
  }, [enabled, filePath, workspaceId]);

  const goToDefinition = useCallback(
    async (line: number, character: number) => {
      if (!enabled || !filePath || !workspaceId) return;
      const loc: LspLocation | null = await vyotiq.lsp.definition({
        workspaceId,
        path: filePath,
        line,
        character
      });
      if (!loc) return;
      await openWorkspaceFileInEditor(loc.filePath, { workspaceId });
      useEditorStore.getState().setActiveTab(loc.filePath);
    },
    [enabled, filePath, workspaceId]
  );

  return { diagnostics, goToDefinition };
}
