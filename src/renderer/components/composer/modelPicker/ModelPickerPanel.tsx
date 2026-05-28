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
import type { ModelInfo, ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { useModelOptions } from './useModelOptions.js';
import {
  EMPTY_FAVORITE_MODELS,
  EMPTY_LAST_MODEL_BY_WORKSPACE,
  useSettingsStore
} from '../../../store/useSettingsStore.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { ProviderGroupHeader } from './ProviderGroupHeader.js';
import { ModelRow } from './ModelRow.js';
import { appPopoverPanelClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ACTION_ICON_STROKE } from '../../../lib/shellIcons.js';

interface ModelPickerPanelProps {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  onClose: () => void;
}

type NavOption = {
  providerId: string;
  modelId: string;
  section: 'recent' | 'favorite' | 'provider';
};

export function ModelPickerPanel({ value, onChange, onClose }: ModelPickerPanelProps) {
  const [query, setQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const didSyncSelectionRef = useRef(false);

  const { localGroups, remoteGroups, flat } = useModelOptions(query);
  const favorites = useSettingsStore(
    (s) => s.settings.ui?.favoriteModels ?? EMPTY_FAVORITE_MODELS
  );
  const lastByWs = useSettingsStore(
    (s) => s.settings.ui?.lastModelByWorkspace ?? EMPTY_LAST_MODEL_BY_WORKSPACE
  );
  const providers = useProviderStore((s) => s.providers);

  const recentOptions = useMemo(() => {
    if (query.trim()) return [];
    const seen = new Set<string>();
    const out: Array<{ providerId: string; model: ModelInfo; provider: ProviderConfig }> = [];
    for (const sel of Object.values(lastByWs)) {
      const key = `${sel.providerId}::${sel.modelId}`;
      if (seen.has(key) || favorites.includes(key)) continue;
      seen.add(key);
      const p = providers.find((x) => x.id === sel.providerId && x.enabled);
      const m = p?.models?.find((x) => x.id === sel.modelId);
      if (p && m) out.push({ providerId: p.id, model: m, provider: p });
    }
    return out.slice(0, 5);
  }, [lastByWs, favorites, providers, query]);

  const favoriteOptions = useMemo(() => {
    if (query.trim()) return [];
    return favorites
      .map((key) => {
        const [providerId, modelId] = key.split('::');
        if (!providerId || !modelId) return null;
        const p = providers.find((x) => x.id === providerId && x.enabled);
        const m = p?.models?.find((x) => x.id === modelId);
        if (!p || !m) return null;
        return { providerId, model: m, provider: p };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [favorites, providers, query]);

  const navOptions: NavOption[] = useMemo(() => {
    if (query.trim()) {
      return flat.map((o) => ({
        providerId: o.providerId,
        modelId: o.modelId,
        section: 'provider' as const
      }));
    }
    const pinnedKeys = new Set<string>();
    const out: NavOption[] = [];
    for (const o of recentOptions) {
      const key = `${o.providerId}::${o.model.id}`;
      pinnedKeys.add(key);
      out.push({ providerId: o.providerId, modelId: o.model.id, section: 'recent' });
    }
    for (const o of favoriteOptions) {
      const key = `${o.providerId}::${o.model.id}`;
      pinnedKeys.add(key);
      out.push({ providerId: o.providerId, modelId: o.model.id, section: 'favorite' });
    }
    for (const o of flat) {
      const key = `${o.providerId}::${o.modelId}`;
      if (pinnedKeys.has(key)) continue;
      out.push({ providerId: o.providerId, modelId: o.modelId, section: 'provider' });
    }
    return out;
  }, [query, flat, recentOptions, favoriteOptions]);

  // Auto-focus the search field on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep focused index within bounds when the filter changes the row count.
  useEffect(() => {
    if (focusedIdx >= navOptions.length) {
      setFocusedIdx(Math.max(0, navOptions.length - 1));
    }
  }, [navOptions.length, focusedIdx]);

  // Pre-focus the currently selected option once when the panel opens
  // with no active search and nav options are ready.
  useEffect(() => {
    if (didSyncSelectionRef.current) return;
    if (query.length > 0 || !value || navOptions.length === 0) return;
    const idx = navOptions.findIndex(
      (o) => o.providerId === value.providerId && o.modelId === value.modelId
    );
    if (idx !== -1) setFocusedIdx(idx);
    didSyncSelectionRef.current = true;
  }, [query, value, navOptions]);

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

  const navIndexFor = (providerId: string, modelId: string) =>
    navOptions.findIndex((o) => o.providerId === providerId && o.modelId === modelId);

  const commitFocused = () => {
    const opt = navOptions[focusedIdx];
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
      if (navOptions.length > 0) setFocusedIdx((i) => (i + 1) % navOptions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (navOptions.length > 0) {
        setFocusedIdx((i) => (i - 1 + navOptions.length) % navOptions.length);
      }
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
        appPopoverPanelClassName,
        'flex max-h-[60vh] w-[320px] flex-col gap-0.5 p-1'
      )}
    >
      <div className="mx-1 mb-1 mt-1 flex items-center gap-1.5">
        <Search className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIdx(0);
          }}
          placeholder="Search models…"
          className="vx-input min-w-0 flex-1 py-0.5 text-row"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Models"
        className="scrollbar-stealth min-h-0 flex-1 overflow-y-auto"
      >
        {recentOptions.length > 0 && (
          <div className="py-1">
            <div className="px-2 py-0.5 text-meta font-medium text-text-faint">Recent</div>
            {recentOptions.map((o) => {
              const idx = navIndexFor(o.providerId, o.model.id);
              return (
                <div key={`recent-${o.providerId}-${o.model.id}`} data-row-idx={idx} className="px-1 pb-0.5">
                  <ModelRow
                    providerId={o.providerId}
                    model={o.model}
                    selected={
                      value?.providerId === o.providerId && value?.modelId === o.model.id
                    }
                    focused={idx === focusedIdx}
                    onSelect={() => {
                      onChange({ providerId: o.providerId, modelId: o.model.id });
                      onClose();
                    }}
                    onMouseEnter={() => setFocusedIdx(idx)}
                  />
                </div>
              );
            })}
          </div>
        )}
        {favoriteOptions.length > 0 && (
          <div className="py-1">
            <div className="px-2 py-0.5 text-meta font-medium text-text-faint">Favorites</div>
            {favoriteOptions.map((o) => {
              const idx = navIndexFor(o.providerId, o.model.id);
              return (
                <div key={`fav-${o.providerId}-${o.model.id}`} data-row-idx={idx} className="px-1 pb-0.5">
                  <ModelRow
                    providerId={o.providerId}
                    model={o.model}
                    selected={
                      value?.providerId === o.providerId && value?.modelId === o.model.id
                    }
                    focused={idx === focusedIdx}
                    onSelect={() => {
                      onChange({ providerId: o.providerId, modelId: o.model.id });
                      onClose();
                    }}
                    onMouseEnter={() => setFocusedIdx(idx)}
                  />
                </div>
              );
            })}
          </div>
        )}
        {localGroups.length > 0 && (
          <div className="py-1">
            <div className="px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-text-faint">
              Local
            </div>
            {localGroups.map((g) => (
              <div key={g.provider.id}>
                <ProviderGroupHeader provider={g.provider} />
                {g.models.map((m) => {
                  const idx = navIndexFor(g.provider.id, m.id);
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
        )}
        {remoteGroups.length > 0 && (
          <div className="py-1">
            <div className="px-2 py-0.5 text-meta font-medium uppercase tracking-wide text-text-faint">
              Cloud
            </div>
            {remoteGroups.map((g) => (
              <div key={g.provider.id}>
                <ProviderGroupHeader provider={g.provider} />
                {g.models.map((m) => {
                  const idx = navIndexFor(g.provider.id, m.id);
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
        )}
      </div>
    </div>
  );
}
