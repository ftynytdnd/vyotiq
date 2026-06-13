/**
 * Vector memory embedder settings (hash default, optional Ollama).
 */

import {
  resolveVectorMemorySettings,
  type VectorEmbedderId
} from '@shared/settings/vectorMemorySettings.js';
import { useSettingsPatch } from '../../hooks/useSettingsPatch.js';
import { useToastStore } from '../../store/useToastStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { ShellCaption, ShellFieldLabel, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { TextField } from '../ui/TextField.js';
import { Button } from '../ui/Button.js';

const EMBEDDER_OPTIONS: { id: VectorEmbedderId; label: string }[] = [
  { id: 'hash', label: 'Local hash (default, zero deps)' },
  { id: 'ollama', label: 'Ollama embeddings' }
];

export function VectorMemoryPanel() {
  const { settings, apply: applySettings } = useSettingsPatch('vector memory settings');
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const resolved = resolveVectorMemorySettings(settings.ui);

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['vectorMemory']>) => {
    applySettings({ ui: { vectorMemory: { ...settings.ui?.vectorMemory, ...patch } } });
  };

  const reindexNow = async () => {
    try {
      await vyotiq.memory.reindex(
        activeWorkspaceId ? { workspaceId: activeWorkspaceId } : undefined
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Re-index failed: ${msg}`, 'danger');
    }
  };

  return (
    <ShellSection title="Vector memory" className="vx-vector-memory-panel">
      <ShellCaption>
        Embedding strategy for the local hybrid index under <code>.vyotiq/vector/</code>. Hash
        embedder is the default; Ollama uses your local server when selected. Changing embedder
        triggers an automatic full re-index for all workspaces.
      </ShellCaption>
      <ShellRow>
        <ShellFieldLabel htmlFor="vector-embedder">Embedder</ShellFieldLabel>
        <select
          id="vector-embedder"
          className="vx-select w-full max-w-md"
          value={resolved.embedder}
          onChange={(e) => apply({ embedder: e.target.value as VectorEmbedderId })}
        >
          {EMBEDDER_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </ShellRow>
      {resolved.embedder === 'ollama' ? (
        <>
          <ShellRow>
            <ShellFieldLabel htmlFor="vector-ollama-base">Ollama base URL</ShellFieldLabel>
            <TextField
              id="vector-ollama-base"
              value={resolved.ollamaBaseUrl}
              onChange={(e) => apply({ ollamaBaseUrl: e.target.value })}
            />
          </ShellRow>
          <ShellRow>
            <ShellFieldLabel htmlFor="vector-ollama-model">Embedding model</ShellFieldLabel>
            <TextField
              id="vector-ollama-model"
              value={resolved.ollamaModel}
              onChange={(e) => apply({ ollamaModel: e.target.value })}
            />
          </ShellRow>
        </>
      ) : null}
      <ShellRow>
        <Button
          variant="ghost"
          size="sm"
          disabled={!activeWorkspaceId}
          onClick={() => void reindexNow()}
        >
          Re-index now
        </Button>
      </ShellRow>
      <p className="text-meta text-text-faint">
        Env override <code className="font-mono">VYOTIQ_VECTOR_EMBED=ollama</code> still wins at
        runtime.
      </p>
    </ShellSection>
  );
}
