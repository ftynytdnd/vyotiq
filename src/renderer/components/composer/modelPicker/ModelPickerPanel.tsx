/**
 * ModelPickerPanel — popover content. Owns search, grouped model list, and a
 * compact side column. Keyboard nav updates focus + preview target;
 * pointer hover previews without selecting.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { ModelInfo, ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { findProviderModel } from './modelPickerContext.js';
import { useModelOptions } from './useModelOptions.js';
import {
  EMPTY_FAVORITE_MODELS,
  EMPTY_LAST_MODEL_BY_WORKSPACE,
  useSettingsStore
} from '../../../store/useSettingsStore.js';
import { useProviderAccountStore } from '../../../store/useProviderAccountStore.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import {
  formatProviderAccountLine,
  isProviderAccountLow
} from '../../../lib/formatProviderAccount.js';
import { ProviderGroupHeader } from './ProviderGroupHeader.js';
import { ModelRow } from './ModelRow.js';
import { ModelPickerSidePanel } from './ModelPickerSidePanel.js';
import { ModelPickerHints } from './ModelPickerHints.js';
import { ModelPickerSectionHeader } from './ModelPickerSectionHeader.js';
import {
  buildPinnedModelKeys,
  catalogModelCount,
  modelPickerKey,
  visibleCatalogGroups,
  type CatalogProviderGroup
} from './modelPickerCatalog.js';
import { appPopoverPanelClassName } from '../../ui/SurfaceShell.js';
import { Button } from '../../ui/Button.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ACTION_ICON_STROKE } from '../../../lib/shellIcons.js';
import { useModelPickerLayout } from './useModelPickerLayout.js';
import { rowDisplayModelId } from './modelPickerDisplay.js';

interface ModelPickerPanelProps {
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
  onClose: () => void;
  onOpenProviders: () => void;
}

type NavOption = {
  providerId: string;
  modelId: string;
  section: 'recent' | 'favorite' | 'provider';
};

function modelKey(providerId: string, modelId: string): string {
  return modelPickerKey(providerId, modelId);
}

function parseModelKey(key: string): { providerId: string; modelId: string } | null {
  const sep = key.indexOf('::');
  if (sep <= 0) return null;
  const providerId = key.slice(0, sep);
  const modelId = key.slice(sep + 2);
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

export function ModelPickerPanel({
  value,
  onChange,
  onClose,
  onOpenProviders
}: ModelPickerPanelProps) {
  const [query, setQuery] = useState('');
  const [visionOnly, setVisionOnly] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(() =>
    value ? modelKey(value.providerId, value.modelId) : null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const didSyncSelectionRef = useRef(false);
  const scrollFromKeyboardRef = useRef(false);

  const { mode, detailsOpen, toggleDetails } = useModelPickerLayout(panelRef);

  const { localGroups, remoteGroups, flat, totalEnabledProviders } = useModelOptions(
    query,
    visionOnly
  );
  const favorites = useSettingsStore(
    (s) => s.settings.ui?.favoriteModels ?? EMPTY_FAVORITE_MODELS
  );
  const lastByWs = useSettingsStore(
    (s) => s.settings.ui?.lastModelByWorkspace ?? EMPTY_LAST_MODEL_BY_WORKSPACE
  );
  const providers = useProviderStore((s) => s.providers);
  const updateProvider = useProviderStore((s) => s.update);

  const hasEnabledProvider = totalEnabledProviders > 0;
  const hasAnyModels = flat.length > 0;
  const trimmedQuery = query.trim();

  const recentOptions = useMemo(() => {
    if (trimmedQuery) return [];
    const seen = new Set<string>();
    const out: Array<{ providerId: string; model: ModelInfo; provider: ProviderConfig }> = [];
    for (const sel of Object.values(lastByWs)) {
      const key = modelKey(sel.providerId, sel.modelId);
      if (seen.has(key) || favorites.includes(key)) continue;
      seen.add(key);
      const p = providers.find((x) => x.id === sel.providerId && x.enabled);
      const m = p ? findProviderModel(p, sel.modelId) : undefined;
      if (p && m) out.push({ providerId: p.id, model: m, provider: p });
    }
    return out.slice(0, 5);
  }, [lastByWs, favorites, providers, trimmedQuery]);

  const favoriteOptions = useMemo(() => {
    if (trimmedQuery) return [];
    return favorites
      .map((key) => {
        const parsed = parseModelKey(key);
        if (!parsed) return null;
        const p = providers.find((x) => x.id === parsed.providerId && x.enabled);
        const m = p ? findProviderModel(p, parsed.modelId) : undefined;
        if (!p || !m) return null;
        return { providerId: parsed.providerId, model: m, provider: p };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [favorites, providers, trimmedQuery]);

  const pinnedCatalogKeys = useMemo(
    () => buildPinnedModelKeys(recentOptions, favoriteOptions, trimmedQuery.length > 0),
    [recentOptions, favoriteOptions, trimmedQuery]
  );

  const visibleLocalGroups = useMemo(
    () => visibleCatalogGroups(localGroups, pinnedCatalogKeys),
    [localGroups, pinnedCatalogKeys]
  );
  const visibleRemoteGroups = useMemo(
    () => visibleCatalogGroups(remoteGroups, pinnedCatalogKeys),
    [remoteGroups, pinnedCatalogKeys]
  );

  const navOptions: NavOption[] = useMemo(() => {
    if (trimmedQuery) {
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
  }, [trimmedQuery, flat, recentOptions, favoriteOptions]);

  const focusedNavKey = useMemo(() => {
    const opt = navOptions[focusedIdx];
    return opt ? modelKey(opt.providerId, opt.modelId) : null;
  }, [navOptions, focusedIdx]);

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
    if (!scrollFromKeyboardRef.current || !focusedNavKey) return;
    scrollFromKeyboardRef.current = false;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-model-key="${focusedNavKey}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedNavKey]);

  const activeParsed = activeKey ? parseModelKey(activeKey) : null;
  const accountProviderId = activeParsed?.providerId ?? value?.providerId;
  const accountSnapshot = useProviderAccountStore((s) =>
    accountProviderId ? s.snapshotFor(accountProviderId) : undefined
  );
  const accountLine = formatProviderAccountLine(accountSnapshot);
  const accountLow = isProviderAccountLow(accountSnapshot);
  const activeProvider = activeParsed
    ? providers.find((p) => p.id === activeParsed.providerId)
    : undefined;
  const activeModelId = activeParsed?.modelId;
  const activeModel: ModelInfo | undefined =
    activeProvider && activeModelId
      ? findProviderModel(activeProvider, activeModelId)
      : undefined;

  const isActiveSelected =
    !!value &&
    !!activeParsed &&
    value.providerId === activeParsed.providerId &&
    value.modelId === activeParsed.modelId;

  const makeSelection = (providerId: string, modelId: string): ModelSelection => {
    if (
      value?.providerId === providerId &&
      value.modelId === modelId &&
      value.thinkingEffort !== undefined
    ) {
      return value;
    }
    const provider = providers.find((p) => p.id === providerId);
    const stored = provider?.modelThinking?.[modelId];
    if (stored !== undefined) {
      return { providerId, modelId, thinkingEffort: stored };
    }
    return { providerId, modelId };
  };

  const renderModelRow = (
    provider: ProviderConfig,
    model: ModelInfo,
    rowKey: string,
    showProviderName = false
  ) => {
    const key = modelKey(provider.id, model.id);
    return (
      <div key={rowKey} data-model-key={key}>
        <ModelRow
          provider={provider}
          model={model}
          selection={value}
          selected={value?.providerId === provider.id && value?.modelId === model.id}
          keyboardFocused={focusedNavKey === key}
          effortActive={key === activeKey}
          showProviderName={showProviderName}
          onPreview={() => setActiveKey(key)}
          onSelect={() => {
            onChange(makeSelection(provider.id, model.id));
            onClose();
          }}
        />
      </div>
    );
  };

  const renderPinnedRows = (
    items: Array<{ providerId: string; model: ModelInfo; provider: ProviderConfig }>,
    keyPrefix: string
  ) => {
    const sorted = [...items].sort((a, b) => {
      const byProvider = a.provider.name.localeCompare(b.provider.name, undefined, {
        sensitivity: 'base'
      });
      if (byProvider !== 0) return byProvider;
      return a.model.id.localeCompare(b.model.id, undefined, { sensitivity: 'base' });
    });
    return sorted.map((o) =>
      renderModelRow(o.provider, o.model, `${keyPrefix}-${o.providerId}-${o.model.id}`, true)
    );
  };

  const renderProviderCatalog = (groups: CatalogProviderGroup[], keyPrefix: string) =>
    groups.map((g) => (
      <div key={`${keyPrefix}-${g.provider.id}`} className="vx-model-picker-provider-group">
        <ProviderGroupHeader provider={g.provider} modelCount={g.models.length} />
        {g.models.map((m) => renderModelRow(g.provider, m, `${keyPrefix}-${g.provider.id}-${m.id}`))}
      </div>
    ));

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

  const showEmptyState = !hasEnabledProvider || !hasAnyModels;

  return (
    <div
      ref={panelRef}
      data-layout={mode}
      onKeyDown={onKeyDown}
      className={cn(
        appPopoverPanelClassName,
        'vx-model-picker-panel',
        'flex h-full max-h-full min-h-0 w-full min-w-0 flex-col p-1'
      )}
    >
      <div className="vx-model-picker-search flex flex-col gap-1">
        <div className="vx-search-row">
          <Search
            className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')}
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
            className="vx-input min-w-0 flex-1 border-0 bg-transparent py-0.5 text-row shadow-none focus:ring-0"
            aria-label="Search models"
          />
          {trimmedQuery ? (
            <span className="shrink-0 px-0.5 font-mono text-meta tabular-nums text-text-faint">
              {navOptions.length}
            </span>
          ) : null}
          <button
            type="button"
            className={cn(
              'vx-btn vx-btn-quiet shrink-0 px-1.5 py-0.5 text-meta',
              visionOnly && 'text-accent'
            )}
            aria-pressed={visionOnly}
            onClick={() => {
              setVisionOnly((v) => !v);
              setFocusedIdx(0);
              syncActiveFromFocused(0);
            }}
          >
            Vision
          </button>
        </div>
        <ModelPickerHints />
      </div>

      {showEmptyState ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="text-meta leading-snug text-text-faint">
            {!hasEnabledProvider
              ? 'Add a provider to browse models.'
              : 'No models available yet. Refresh a provider in Settings or discover models.'}
          </p>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              onOpenProviders();
              onClose();
            }}
          >
            {!hasEnabledProvider ? 'Add provider' : 'Open provider settings'}
          </Button>
        </div>
      ) : (
        <div className="vx-model-picker-body">
          <div
            ref={listRef}
            role="listbox"
            aria-label="Models"
            className="vx-model-picker-list scrollbar-stealth"
          >
            {!trimmedQuery && recentOptions.length > 0 && (
              <div className="vx-model-picker-section">
                <ModelPickerSectionHeader
                  label="Recent"
                  variant="pinned"
                  count={recentOptions.length}
                />
                {renderPinnedRows(recentOptions, 'recent')}
              </div>
            )}
            {!trimmedQuery && favoriteOptions.length > 0 && (
              <div className="vx-model-picker-section">
                <ModelPickerSectionHeader
                  label="Favorites"
                  variant="pinned"
                  count={favoriteOptions.length}
                />
                {renderPinnedRows(favoriteOptions, 'fav')}
              </div>
            )}
            {visibleLocalGroups.length > 0 && (
              <div className="vx-model-picker-section">
                <ModelPickerSectionHeader
                  label="Local"
                  variant="category"
                  count={catalogModelCount(visibleLocalGroups)}
                />
                {renderProviderCatalog(visibleLocalGroups, trimmedQuery ? 'search-local' : 'local')}
              </div>
            )}
            {visibleRemoteGroups.length > 0 && (
              <div className="vx-model-picker-section">
                <ModelPickerSectionHeader
                  label="Cloud"
                  variant="category"
                  count={catalogModelCount(visibleRemoteGroups)}
                />
                {renderProviderCatalog(
                  visibleRemoteGroups,
                  trimmedQuery ? 'search-cloud' : 'cloud'
                )}
              </div>
            )}
            {navOptions.length === 0 && (
              <div className="px-3 py-6 text-center text-meta text-text-faint">
                No models match your search.
              </div>
            )}
          </div>

          {activeProvider && activeModelId ? (
            <div
              className={cn(
                'vx-model-picker-side',
                mode === 'stacked' && !detailsOpen && 'vx-model-picker-side--collapsed'
              )}
            >
              {mode === 'stacked' ? (
                <button
                  type="button"
                  className="vx-model-picker-side-toggle"
                  aria-expanded={detailsOpen}
                  aria-controls="vx-model-picker-side-panel"
                  onClick={toggleDetails}
                >
                  <span
                    className="min-w-0 flex-1 truncate text-left font-mono text-meta text-text-secondary"
                    title={activeModelId}
                  >
                    {rowDisplayModelId(activeModelId)}
                  </span>
                  <span className="shrink-0 text-meta text-text-faint">
                    {detailsOpen ? 'Hide' : 'Details'}
                  </span>
                  <ChevronDown
                    className={cn(
                      SHELL_ROW_ICON_CLASS,
                      'shrink-0 text-text-faint transition-transform duration-150',
                      detailsOpen && 'rotate-180'
                    )}
                    strokeWidth={SHELL_ACTION_ICON_STROKE}
                    aria-hidden
                  />
                </button>
              ) : null}
              {(mode === 'split' || detailsOpen) && (
                <ModelPickerSidePanel
                  provider={activeProvider}
                  modelId={activeModelId}
                  model={activeModel}
                  selection={value}
                  isSelected={isActiveSelected}
                  onChange={onChange}
                  updateProvider={updateProvider}
                  makeSelection={makeSelection}
                  className="vx-model-picker-side-inner scrollbar-stealth"
                />
              )}
            </div>
          ) : (
            <aside
              className="vx-model-picker-side vx-model-picker-side--empty flex flex-col justify-center px-2 py-2"
              aria-label="Model options"
            >
              <p className="text-meta leading-snug text-text-faint">
                Arrow to a model for effort and context.
              </p>
            </aside>
          )}
        </div>
      )}

      {!showEmptyState ? (
        <footer className="vx-model-picker-footer flex shrink-0 items-center justify-between gap-2 border-t border-border-subtle/25 px-2 py-1.5">
          <div className="min-w-0 flex flex-col gap-0.5">
            <span className="font-mono text-meta tabular-nums text-text-faint">
              {navOptions.length} model{navOptions.length === 1 ? '' : 's'}
            </span>
            {accountLine ? (
              <span
                className={cn(
                  'truncate font-mono text-meta tabular-nums',
                  accountLow ? 'text-warning' : 'text-text-faint'
                )}
                title={accountLine}
              >
                {accountLine}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              onOpenProviders();
              onClose();
            }}
            className="vx-btn vx-btn-quiet min-h-6 px-1.5 py-1 font-mono text-meta text-text-faint hover:text-text-secondary"
          >
            Manage providers
          </button>
        </footer>
      ) : null}
    </div>
  );
}
