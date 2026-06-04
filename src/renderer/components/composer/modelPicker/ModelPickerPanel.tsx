/**
 * ModelPickerPanel — popover content. Owns search, grouped model list, and a
 * fixed-width effort column. Keyboard nav updates focus + effort target;
 * pointer hover uses CSS only (no layout reflow).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { ModelInfo, ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { isThinkingCapableModel } from '@shared/providers/thinkingEffort.js';
import {
  applyThinkingEffortChange,
  applyThinkingEffortClear,
  rowThinkingEffort
} from './modelPickerThinking.js';
import { ThinkingEffortOptionList } from '../../shared/ThinkingEffortOptionList.js';
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

const PANEL_WIDTH_CLASS = 'w-[min(42rem,calc(100vw-1.5rem))]';
const EFFORT_COLUMN_CLASS = 'w-[9.75rem] shrink-0 border-l border-border-subtle/30';

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

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function parseModelKey(key: string): { providerId: string; modelId: string } | null {
  const sep = key.indexOf('::');
  if (sep <= 0) return null;
  const providerId = key.slice(0, sep);
  const modelId = key.slice(sep + 2);
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

export function ModelPickerPanel({ value, onChange, onClose }: ModelPickerPanelProps) {
  const [query, setQuery] = useState('');
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(() =>
    value ? modelKey(value.providerId, value.modelId) : null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const didSyncSelectionRef = useRef(false);
  const scrollFromKeyboardRef = useRef(false);

  const { localGroups, remoteGroups, flat } = useModelOptions(query);
  const favorites = useSettingsStore(
    (s) => s.settings.ui?.favoriteModels ?? EMPTY_FAVORITE_MODELS
  );
  const lastByWs = useSettingsStore(
    (s) => s.settings.ui?.lastModelByWorkspace ?? EMPTY_LAST_MODEL_BY_WORKSPACE
  );
  const providers = useProviderStore((s) => s.providers);
  const updateProvider = useProviderStore((s) => s.update);

  const recentOptions = useMemo(() => {
    if (query.trim()) return [];
    const seen = new Set<string>();
    const out: Array<{ providerId: string; model: ModelInfo; provider: ProviderConfig }> = [];
    for (const sel of Object.values(lastByWs)) {
      const key = modelKey(sel.providerId, sel.modelId);
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
        const parsed = parseModelKey(key);
        if (!parsed) return null;
        const p = providers.find((x) => x.id === parsed.providerId && x.enabled);
        const m = p?.models?.find((x) => x.id === parsed.modelId);
        if (!p || !m) return null;
        return { providerId: parsed.providerId, model: m, provider: p };
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
      const key = modelKey(o.providerId, o.model.id);
      pinnedKeys.add(key);
      out.push({ providerId: o.providerId, modelId: o.model.id, section: 'recent' });
    }
    for (const o of favoriteOptions) {
      const key = modelKey(o.providerId, o.model.id);
      pinnedKeys.add(key);
      out.push({ providerId: o.providerId, modelId: o.model.id, section: 'favorite' });
    }
    for (const o of flat) {
      const key = modelKey(o.providerId, o.modelId);
      if (pinnedKeys.has(key)) continue;
      out.push({ providerId: o.providerId, modelId: o.modelId, section: 'provider' });
    }
    return out;
  }, [query, flat, recentOptions, favoriteOptions]);

  const syncActiveFromFocused = useCallback(
    (idx: number) => {
      const opt = navOptions[idx];
      if (opt) setActiveKey(modelKey(opt.providerId, opt.modelId));
    },
    [navOptions]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (focusedIdx >= navOptions.length) {
      setFocusedIdx(Math.max(0, navOptions.length - 1));
    }
  }, [navOptions.length, focusedIdx]);

  useEffect(() => {
    if (didSyncSelectionRef.current) return;
    if (query.length > 0 || !value || navOptions.length === 0) return;
    const idx = navOptions.findIndex(
      (o) => o.providerId === value.providerId && o.modelId === value.modelId
    );
    if (idx !== -1) {
      setFocusedIdx(idx);
      setActiveKey(modelKey(value.providerId, value.modelId));
    }
    didSyncSelectionRef.current = true;
  }, [query, value, navOptions]);

  useEffect(() => {
    if (!scrollFromKeyboardRef.current) return;
    scrollFromKeyboardRef.current = false;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row-idx="${focusedIdx}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx]);

  const navIndexFor = (providerId: string, modelId: string) =>
    navOptions.findIndex((o) => o.providerId === providerId && o.modelId === modelId);

  const activeParsed = activeKey ? parseModelKey(activeKey) : null;
  const activeProvider = activeParsed
    ? providers.find((p) => p.id === activeParsed.providerId)
    : undefined;
  const activeModelId = activeParsed?.modelId;
  const activeThinking =
    activeProvider && activeModelId
      ? isThinkingCapableModel(activeProvider.dialect, activeModelId)
      : false;
  const activeEffortValue =
    activeProvider && activeModelId
      ? rowThinkingEffort(activeProvider, activeModelId, value)
      : undefined;

  const makeSelection = (providerId: string, modelId: string): ModelSelection => {
    if (
      value?.providerId === providerId &&
      value.modelId === modelId &&
      value.thinkingEffort !== undefined
    ) {
      return value;
    }
    return { providerId, modelId };
  };

  const focusRowByKey = (key: string) => {
    const idx = navOptions.findIndex(
      (o) => modelKey(o.providerId, o.modelId) === key
    );
    if (idx !== -1) setFocusedIdx(idx);
    setActiveKey(key);
  };

  const renderModelRow = (
    provider: ProviderConfig,
    model: ModelInfo,
    idx: number,
    rowKey: string
  ) => {
    const key = modelKey(provider.id, model.id);
    const navIdx = navIndexFor(provider.id, model.id);
    const rowNavIdx = navIdx >= 0 ? navIdx : idx;

    return (
      <div key={rowKey} data-row-idx={rowNavIdx} className="px-0.5 pb-px">
        <ModelRow
          provider={provider}
          model={model}
          selection={value}
          selected={value?.providerId === provider.id && value?.modelId === model.id}
          keyboardFocused={rowNavIdx === focusedIdx}
          effortActive={key === activeKey}
          onActivate={() => focusRowByKey(key)}
          onSelect={() => {
            onChange(makeSelection(provider.id, model.id));
            onClose();
          }}
        />
      </div>
    );
  };

  const commitFocused = () => {
    const opt = navOptions[focusedIdx];
    if (!opt) return;
    onChange(makeSelection(opt.providerId, opt.modelId));
    onClose();
  };

  const moveFocus = (nextIdx: number) => {
    scrollFromKeyboardRef.current = true;
    setFocusedIdx(nextIdx);
    syncActiveFromFocused(nextIdx);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (navOptions.length > 0) {
        moveFocus((focusedIdx + 1) % navOptions.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (navOptions.length > 0) {
        moveFocus((focusedIdx - 1 + navOptions.length) % navOptions.length);
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
        PANEL_WIDTH_CLASS,
        'flex max-h-[min(60vh,28rem)] flex-col gap-0.5 p-1'
      )}
    >
      <div className="mx-1 mb-1 mt-1 flex items-center gap-1.5">
        <Search
          className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIdx(0);
            syncActiveFromFocused(0);
          }}
          placeholder="Search models…"
          className="vx-input min-w-0 flex-1 py-0.5 text-row"
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          role="listbox"
          aria-label="Models"
          className="scrollbar-stealth min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          {recentOptions.length > 0 && (
            <div className="py-1">
              <div className="px-2 py-0.5 text-meta font-medium text-text-faint">Recent</div>
              {recentOptions.map((o) =>
                renderModelRow(
                  o.provider,
                  o.model,
                  navIndexFor(o.providerId, o.model.id),
                  `recent-${o.providerId}-${o.model.id}`
                )
              )}
            </div>
          )}
          {favoriteOptions.length > 0 && (
            <div className="py-1">
              <div className="px-2 py-0.5 text-meta font-medium text-text-faint">Favorites</div>
              {favoriteOptions.map((o) =>
                renderModelRow(
                  o.provider,
                  o.model,
                  navIndexFor(o.providerId, o.model.id),
                  `fav-${o.providerId}-${o.model.id}`
                )
              )}
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
                  {g.models.map((m) =>
                    renderModelRow(
                      g.provider,
                      m,
                      navIndexFor(g.provider.id, m.id),
                      `local-${g.provider.id}-${m.id}`
                    )
                  )}
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
                  {g.models.map((m) =>
                    renderModelRow(
                      g.provider,
                      m,
                      navIndexFor(g.provider.id, m.id),
                      `cloud-${g.provider.id}-${m.id}`
                    )
                  )}
                </div>
              ))}
            </div>
          )}
          {navOptions.length === 0 && (
            <div className="px-3 py-6 text-center text-meta text-text-faint">
              {query.trim()
                ? 'No models match your search.'
                : 'No models available. Refresh a provider in Settings.'}
            </div>
          )}
        </div>
        <aside className={cn(EFFORT_COLUMN_CLASS, 'flex min-h-0 flex-col')} aria-label="Model options">
          {activeProvider && activeModelId && activeThinking ? (
            <ThinkingEffortOptionList
              key={activeKey ?? undefined}
              dialect={activeProvider.dialect}
              modelId={activeModelId}
              value={activeEffortValue}
              onSelect={(effort) =>
                applyThinkingEffortChange(
                  activeProvider.id,
                  activeModelId,
                  effort,
                  value,
                  onChange,
                  updateProvider
                )
              }
              onClear={() =>
                applyThinkingEffortClear(
                  activeProvider.id,
                  activeModelId,
                  value,
                  onChange,
                  updateProvider
                )
              }
            />
          ) : (
            <div className="flex flex-1 flex-col px-2.5 py-3">
              <div className="py-1 text-meta font-medium text-text-faint">Effort</div>
              <p className="text-meta leading-snug text-text-faint">
                {activeModelId
                  ? 'This model does not support thinking effort.'
                  : 'Select a model to configure effort.'}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
