/**
 * ModelPickerPanel — popover content. Owns:
 *
 *   - the search input (auto-focused when the panel mounts)
 *   - the grouped, filtered list of models (via `useModelOptions`)
 *   - keyboard navigation across the flattened option list:
 *       ArrowDown / ArrowUp  — move focus
 *       Enter                — commit focused option
 *       Escape               — close the popover
 *       `/`                  — re-focus the search input
 *
 * Mouse hover also drives the focused index so the highlighted row tracks
 * the pointer (matches the feel of native command-palettes).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { useModelOptions } from './useModelOptions.js';
import { ProviderGroupHeader } from './ProviderGroupHeader.js';
import { ModelRow } from './ModelRow.js';
import { TextField } from '../../ui/TextField.js';
import {
  chromeElev2PanelClassName,
  chromeSearchRowClassName
} from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';

interface ModelPickerPanelProps {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  onClose: () => void;
}

export function ModelPickerPanel({ value, onChange, onClose }: ModelPickerPanelProps) {
  const [query, setQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { groups, flat } = useModelOptions(query);

  // Auto-focus the search field on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep focused index within bounds when the filter changes the row count.
  useEffect(() => {
    if (focusedIdx >= flat.length) {
      setFocusedIdx(Math.max(0, flat.length - 1));
    }
  }, [flat.length, focusedIdx]);

  // Pre-focus the currently selected option when the panel opens with no
  // active search.
  useEffect(() => {
    if (query.length > 0 || !value) return;
    const idx = flat.findIndex(
      (o) => o.providerId === value.providerId && o.modelId === value.modelId
    );
    if (idx !== -1) setFocusedIdx(idx);
    // Run only on initial mount; subsequent navigations are user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll the focused row into view as keyboard nav moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-idx="${focusedIdx}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  const selectedKey = useMemo(
    () => (value ? `${value.providerId}::${value.modelId}` : null),
    [value]
  );

  const commitFocused = () => {
    const opt = flat[focusedIdx];
    if (!opt) return;
    onChange({ providerId: opt.providerId, modelId: opt.modelId });
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length > 0) setFocusedIdx((i) => (i + 1) % flat.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length > 0) setFocusedIdx((i) => (i - 1 + flat.length) % flat.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitFocused();
      return;
    }
    if (e.key === '/' && document.activeElement !== inputRef.current) {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  return (
    <div
      onKeyDown={onKeyDown}
      className={cn(
        chromeElev2PanelClassName,
        'flex max-h-[60vh] w-[320px] flex-col p-1'
      )}
    >
      <div className={cn(chromeSearchRowClassName, 'mx-1 mb-1 mt-1 border-0 bg-transparent')}>
        <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
        <TextField
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIdx(0);
          }}
          placeholder="Search models…"
          size="sm"
          tone="transparent"
          className="min-w-0 flex-1 px-0"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Models"
        className="scrollbar-stealth min-h-0 flex-1 overflow-y-auto"
      >
        {groups.map((g) => (
          <div key={g.provider.id} className="py-1">
            <ProviderGroupHeader provider={g.provider} />
            {g.models.map((m) => {
              const idx = flat.findIndex(
                (o) => o.providerId === g.provider.id && o.modelId === m.id
              );
              const composedKey = `${g.provider.id}::${m.id}`;
              return (
                <div key={m.id} data-row-idx={idx} className="px-1 pb-0.5">
                  <ModelRow
                    providerId={g.provider.id}
                    model={m}
                    selected={composedKey === selectedKey}
                    focused={idx === focusedIdx}
                    onSelect={() => {
                      onChange({ providerId: g.provider.id, modelId: m.id });
                      onClose();
                    }}
                    onMouseEnter={() => setFocusedIdx(idx)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
