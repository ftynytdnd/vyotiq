/**
 * Vector memory embedder settings (hash default, optional Ollama).
 */

import {
  resolveVectorMemorySettings,
  type VectorEmbedderId
} from '@shared/settings/vectorMemorySettings.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { ShellCaption, ShellFieldLabel, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { TextField } from '../ui/TextField.js';

const EMBEDDER_OPTIONS: { id: VectorEmbedderId; label: string }[] = [
  { id: 'hash', label: 'Local hash (default, zero deps)' },
  { id: 'ollama', label: 'Ollama embeddings' }
];

export function VectorMemoryPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const refresh = useSettingsStore((s) => s.refresh);
  const resolved = resolveVectorMemorySettings(settings.ui);

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['vectorMemory']>) => {
    void vyotiq.settings
      .set({ ui: { vectorMemory: { ...settings.ui?.vectorMemory, ...patch } } })
      .then(() => refresh())
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save vector memory settings: ${msg}`, 'danger');
      });
  };

  return (
    <ShellSection title="Vector memory" className="vx-vector-memory-panel">
      <ShellCaption>
        Embedding strategy for the local hybrid index under <code>.vyotiq/vector/</code>. Hash
        embedder is the default; Ollama uses your local server when selected.
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
      <p className="text-meta text-text-faint">
        Env override <code className="font-mono">VYOTIQ_VECTOR_EMBED=ollama</code> still wins at
        runtime. Re-index after changing embedder.
      </p>
    </ShellSection>
  );
}
