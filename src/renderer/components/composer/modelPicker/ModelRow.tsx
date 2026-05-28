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

import { memo, useState, useRef, useEffect } from 'react';
import { Check, Pencil, Star } from 'lucide-react';
import type { ModelInfo } from '@shared/types/provider.js';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../../lib/cn.js';
import { TextField } from '../../ui/TextField.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';
import { formatTokenCount, parseTokenCount } from '../../../lib/formatTokens.js';
import {
  useProviderStore,
  selectEffectiveContextWindow
} from '../../../store/useProviderStore.js';
import {
  EMPTY_FAVORITE_MODELS,
  useSettingsStore
} from '../../../store/useSettingsStore.js';

interface ModelRowProps {
  /** Owning provider id, needed to route the override write. */
  providerId: string;
  model: ModelInfo;
  selected: boolean;
  focused: boolean;
  onSelect: () => void;
  onMouseEnter?: () => void;
}

export const ModelRow = memo(function ModelRow({
  providerId,
  model,
  selected,
  focused,
  onSelect,
  onMouseEnter
}: ModelRowProps) {
  const favoriteKey = `${providerId}::${model.id}`;
  const isFavorite = useSettingsStore((s) =>
    (s.settings.ui?.favoriteModels ?? EMPTY_FAVORITE_MODELS).includes(favoriteKey)
  );
  const toggleFavorite = useSettingsStore((s) => s.toggleFavoriteModel);

  return (
    <div
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      className="vx-dropdown-item group flex w-full items-center gap-2"
      data-active={focused || selected ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Check
          className={cn(
            SHELL_ROW_ICON_CLASS,
            selected ? 'text-accent' : 'opacity-0'
          )}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
        <span className="min-w-0 flex-1 truncate font-mono" title={model.id}>
          {model.id}
        </span>
      </button>
      <button
        type="button"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Unfavorite' : 'Favorite'}
        onClick={(e) => {
          e.stopPropagation();
          void toggleFavorite(providerId, model.id);
        }}
        className="vx-btn vx-btn-quiet shrink-0 px-0.5 py-0.5 opacity-0 group-hover:opacity-100 data-[fav=true]:opacity-100"
        data-fav={isFavorite ? 'true' : 'false'}
      >
        <Star
          className={cn(SHELL_MICRO_ICON_CLASS, isFavorite && 'fill-accent text-accent')}
          strokeWidth={SHELL_MICRO_ICON_STROKE}
        />
      </button>
      <ContextWindowEditor providerId={providerId} modelId={model.id} />
    </div>
  );
});

/**
 * Inline ctx-window pill + editor. Reads the effective value
 * (override ?? discovered) from the provider store; writes through
 * `setContextOverride`. Designed to be unobtrusive: the pencil icon
 * only appears on row hover; the pill itself is display-only unless
 * clicked.
 */
const ContextWindowEditor = memo(function ContextWindowEditor({
  providerId,
  modelId
}: {
  providerId: string;
  modelId: string;
}) {
  const { effective, hasOverride } = useProviderStore(
    useShallow((s) => {
      const p = s.providers.find((x) => x.id === providerId);
      return {
        effective: selectEffectiveContextWindow(s.providers, providerId, modelId),
        hasOverride: !!p?.contextOverrides?.[modelId]
      };
    })
  );
  const setContextOverride = useProviderStore((s) => s.setContextOverride);

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
      <TextField
        ref={inputRef}
        appearance="boxed"
        size="sm"
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
        className="w-20 shrink-0 font-mono text-right"
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
        'vx-btn vx-btn-quiet shrink-0 gap-1 px-1.5 py-0.5 font-mono text-meta',
        hasOverride && 'ring-1 ring-edge-light-focus'
      )}
    >
      {typeof effective === 'number' ? formatTokenCount(effective) : 'set'}
      <Pencil
        className={cn(SHELL_MICRO_ICON_CLASS, 'opacity-0 group-hover:opacity-70')}
        strokeWidth={SHELL_MICRO_ICON_STROKE}
      />
    </button>
  );
});
