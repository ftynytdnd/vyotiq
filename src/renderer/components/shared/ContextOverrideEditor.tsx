/**
 * Compact per-model context-window override editor (Settings + composer).
 */

import { useEffect, useRef, useState } from 'react';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { Button } from '../ui/Button.js';
import { TextField } from '../ui/TextField.js';
import { cn } from '../../lib/cn.js';

export interface ContextOverrideEditorProps {
  modelId: string;
  discovered?: number;
  /** When true, discovered value was inferred from the model id. */
  discoveredEstimated?: boolean;
  override?: number;
  onSave: (tokens: number) => void;
  onClear: () => void;
  /** `explicit` — Save/Reset buttons (Settings). `auto` — commit on Enter/blur (picker). */
  mode?: 'explicit' | 'auto';
  /** Tighter layout for composer picker side panel. */
  compact?: boolean;
  className?: string;
}

export function ContextOverrideEditor({
  modelId,
  discovered,
  discoveredEstimated = false,
  override,
  onSave,
  onClear,
  mode = 'explicit',
  compact = false,
  className
}: ContextOverrideEditorProps) {
  const effective = override ?? discovered;
  const [draft, setDraft] = useState(
    override !== undefined ? String(override) : discovered !== undefined ? String(discovered) : ''
  );
  const lastCommittedRef = useRef(
    override !== undefined ? String(override) : discovered !== undefined ? String(discovered) : ''
  );

  useEffect(() => {
    const next =
      override !== undefined ? String(override) : discovered !== undefined ? String(discovered) : '';
    setDraft(next);
    lastCommittedRef.current = next;
  }, [modelId, discovered, override]);

  const commit = () => {
    const n = Math.floor(Number(draft.replace(/,/g, '')));
    if (!Number.isFinite(n) || n <= 0) return;
    if (draft === lastCommittedRef.current) return;
    lastCommittedRef.current = draft;
    onSave(n);
  };

  const onBlur = () => {
    if (mode === 'auto') commit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (mode === 'auto' && e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.target as HTMLInputElement).blur();
    }
  };

  const discoveredPrefix = discoveredEstimated ? '~' : '';
  const formatDiscovered = (n: number) => `${discoveredPrefix}${formatTokenCount(n)}`;

  const effectiveLabel =
    typeof effective === 'number' && effective > 0
      ? formatTokenCount(effective)
      : null;

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col gap-2 px-2.5',
        compact && mode === 'auto' && 'gap-1.5',
        className
      )}
      role="group"
      aria-label={`Context window for ${modelId}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {compact && mode === 'auto' ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-meta font-medium text-text-faint">Context</div>
            {effectiveLabel ? (
              <span className="font-mono text-meta tabular-nums text-text-secondary">
                {effectiveLabel}
                {override !== undefined && discovered !== undefined && override !== discovered
                  ? ` · ${formatDiscovered(discovered)}`
                  : null}
              </span>
            ) : (
              <span className="text-meta text-text-faint">Unknown</span>
            )}
          </div>
          <TextField
            className="vx-model-picker-context-input w-full font-mono text-meta"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            placeholder="Override tokens…"
            aria-label="Context window tokens"
          />
          {override !== undefined ? (
            <button
              type="button"
              className="vx-caption self-start text-text-faint hover:text-text-secondary"
              onClick={onClear}
            >
              Reset to discovered
            </button>
          ) : null}
        </>
      ) : (
        <>
          <div className="text-meta font-medium text-text-faint">Context</div>
          {effectiveLabel ? (
            <p className="text-meta leading-snug text-text-faint">
              Effective: {effectiveLabel}
              {override !== undefined && discovered !== undefined && override !== discovered
                ? ` (discovered ${formatDiscovered(discovered)})`
                : discoveredEstimated && discovered !== undefined
                  ? ' (estimated from model id)'
                  : null}
            </p>
          ) : (
            <p className="text-meta leading-snug text-text-faint">No context size discovered.</p>
          )}
          <TextField
            className="w-full font-mono text-row"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            placeholder="Token limit…"
            aria-label="Context window tokens"
          />
          {mode === 'explicit' ? (
            <div className="flex flex-wrap gap-1.5">
              <Button variant="secondary" type="button" onClick={commit}>
                Save
              </Button>
              {override !== undefined ? (
                <Button variant="secondary" type="button" onClick={onClear}>
                  Reset
                </Button>
              ) : null}
            </div>
          ) : override !== undefined ? (
            <button
              type="button"
              className="vx-caption self-start text-text-faint hover:text-text-secondary"
              onClick={onClear}
            >
              Reset to discovered
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
