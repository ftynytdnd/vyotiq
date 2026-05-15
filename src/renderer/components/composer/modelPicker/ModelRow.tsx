/**
 * Single model row in the picker panel. Renders the model id (monospace),
 * a check icon for the currently-selected model, and a context-window
 * pill on the right. The pill is editable: clicking the pencil icon
 * (revealed on hover) swaps the label for an inline text input that
 * accepts `128k`, `1.5M`, or raw integer syntax. Pressing Enter saves
 * via `setContextOverride`; Escape cancels. Clearing the input and
 * committing removes the override.
 *
 * Visual states:
 *   - default     : muted text, no background
 *   - focused/hover: accent-tinted background (subtle blue wash)
 *   - selected    : check icon + brighter text (works regardless of focus)
 */

import { useState, useRef, useEffect } from 'react';
import { Check, Pencil } from 'lucide-react';
import type { ModelInfo } from '@shared/types/provider.js';
import { cn } from '../../../lib/cn.js';
import { formatTokenCount, parseTokenCount } from '../../../lib/formatTokens.js';
import {
  useProviderStore,
  selectEffectiveContextWindow
} from '../../../store/useProviderStore.js';

interface ModelRowProps {
  /** Owning provider id, needed to route the override write. */
  providerId: string;
  model: ModelInfo;
  selected: boolean;
  focused: boolean;
  onSelect: () => void;
  onMouseEnter?: () => void;
}

export function ModelRow({
  providerId,
  model,
  selected,
  focused,
  onSelect,
  onMouseEnter
}: ModelRowProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-row',
        'transition-colors duration-150',
        focused
          ? 'bg-accent-soft text-text-primary'
          : selected
            ? 'text-text-primary'
            : 'text-text-secondary hover:bg-accent-soft hover:text-text-primary'
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Check
          className={cn(
            'h-3 w-3 shrink-0',
            selected ? 'text-accent' : 'opacity-0'
          )}
          strokeWidth={2.25}
        />
        <span className="min-w-0 flex-1 truncate font-mono" title={model.id}>
          {model.id}
        </span>
      </button>
      <ContextWindowEditor providerId={providerId} modelId={model.id} />
    </div>
  );
}

/**
 * Inline ctx-window pill + editor. Reads the effective value
 * (override ?? discovered) from the provider store; writes through
 * `setContextOverride`. Designed to be unobtrusive: the pencil icon
 * only appears on row hover; the pill itself is display-only unless
 * clicked.
 */
function ContextWindowEditor({
  providerId,
  modelId
}: {
  providerId: string;
  modelId: string;
}) {
  const providers = useProviderStore((s) => s.providers);
  const setContextOverride = useProviderStore((s) => s.setContextOverride);
  const effective = selectEffectiveContextWindow(providers, providerId, modelId);
  const hasOverride = !!providers.find((p) => p.id === providerId)?.contextOverrides?.[modelId];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const openEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(typeof effective === 'number' ? formatTokenCount(effective) : '');
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      // Empty → clear the override.
      void setContextOverride(providerId, modelId, null);
      setEditing(false);
      return;
    }
    const parsed = parseTokenCount(trimmed);
    if (parsed === null) {
      setEditing(false);
      return;
    }
    void setContextOverride(providerId, modelId, parsed);
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder="e.g. 128k"
        className={cn(
          'w-20 shrink-0 rounded bg-surface-base/80 px-1.5 py-0.5 font-mono text-meta',
          'text-text-primary outline-none focus:outline-none ring-1 ring-accent/50'
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={openEditor}
      title={
        typeof effective === 'number'
          ? `${effective.toLocaleString()} tokens${hasOverride ? ' (pinned)' : ''} — click to edit`
          : 'Set context window'
      }
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded bg-surface-base/60 px-1.5 py-0.5 font-mono text-meta',
        'text-text-faint hover:bg-surface-base hover:text-text-secondary transition-colors duration-150',
        hasOverride ? 'ring-1 ring-accent/40' : ''
      )}
    >
      {typeof effective === 'number' ? formatTokenCount(effective) : 'set'}
      <Pencil
        className="h-2.5 w-2.5 opacity-0 group-hover:opacity-80"
        strokeWidth={2}
      />
    </button>
  );
}
