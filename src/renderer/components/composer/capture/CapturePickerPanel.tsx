/**
 * Capture picker — grouped displays/windows with preview thumbnails.
 */

import { useCallback, useEffect, useMemo, useLayoutEffect, useRef } from 'react';
import { AppWindow, Loader2, Monitor } from 'lucide-react';
import type { CaptureSourceInfo } from '@shared/types/capture.js';
import {
  CAPTURE_PICKER_SEARCH_THRESHOLD,
  CAPTURE_PICKER_VIRTUALIZE_THRESHOLD
} from '@shared/capture/capturePickerConstants.js';
import { appPopoverPanelClassName } from '../../ui/SurfaceShell.js';
import { ModelPickerSectionHeader } from '../modelPicker/ModelPickerSectionHeader.js';
import { cn } from '../../../lib/cn.js';
import { openCapturePermissionSettings } from '../../../lib/openCapturePermissionSettings.js';
import { groupCaptureSources } from './groupCaptureSources.js';
import {
  buildCapturePickerNavRows,
  captureNavSubtitle,
  filterGroupedCaptureSources,
  countCaptureCatalog
} from './capturePickerModel.js';
import { CapturePickerHints } from './CapturePickerHints.js';
import { CapturePickerRow, CapturePickerSkeletonRows } from './CapturePickerRow.js';
import { CapturePickerWindowList } from './CapturePickerWindowList.js';
import { TextField } from '../../ui/TextField.js';

interface CapturePickerPanelProps {
  loading: boolean;
  showSkeleton: boolean;
  loadingThumbnails: boolean;
  capturing: boolean;
  capturingRowId: string | null;
  sources: CaptureSourceInfo[];
  activeNavId: string;
  onActiveNavIdChange: (id: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onCaptureAppWindow: () => void;
  onCaptureSource: (sourceId: string, rowId: string) => void;
  onClose: () => void;
}

export function CapturePickerPanel({
  loading,
  showSkeleton,
  loadingThumbnails,
  capturing,
  capturingRowId,
  sources,
  activeNavId,
  onActiveNavIdChange,
  query,
  onQueryChange,
  onCaptureAppWindow,
  onCaptureSource,
  onClose
}: CapturePickerPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollFromKeyboardRef = useRef(false);
  const didAutofocusRef = useRef(false);

  useLayoutEffect(() => {
    if (didAutofocusRef.current) return;
    didAutofocusRef.current = true;
    const firstRow = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    if (!firstRow) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (panelRef.current?.contains(active) || firstRow.contains(active))
    ) {
      return;
    }
    firstRow.focus();
  }, []);

  const { screens: allScreens, windows: allWindows } = groupCaptureSources(sources);
  const { screens, windows } = filterGroupedCaptureSources(allScreens, allWindows, query);
  const hasCatalog = countCaptureCatalog(allScreens, allWindows) > 0;
  const showSearch = allWindows.length > CAPTURE_PICKER_SEARCH_THRESHOLD;
  const virtualizeWindows = windows.length > CAPTURE_PICKER_VIRTUALIZE_THRESHOLD;

  const navRows = useMemo(
    () => buildCapturePickerNavRows(screens, windows),
    [screens, windows]
  );

  const activeIndex = Math.max(
    0,
    navRows.findIndex((row) => row.id === activeNavId)
  );

  useEffect(() => {
    if (!scrollFromKeyboardRef.current) return;
    scrollFromKeyboardRef.current = false;
    const el = document.getElementById(`capture-row-${activeNavId}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeNavId]);

  const commitActive = useCallback(() => {
    const row = navRows[activeIndex];
    if (!row || capturing) return;
    if (row.kind === 'app-window') onCaptureAppWindow();
    else onCaptureSource(row.sourceId, row.id);
  }, [activeIndex, capturing, navRows, onCaptureAppWindow, onCaptureSource]);

  const moveActive = useCallback(
    (delta: number) => {
      if (navRows.length === 0) return;
      scrollFromKeyboardRef.current = true;
      const next = (activeIndex + delta + navRows.length) % navRows.length;
      onActiveNavIdChange(navRows[next]!.id);
    },
    [activeIndex, navRows, onActiveNavIdChange]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      if (navRows[0]) onActiveNavIdChange(navRows[0].id);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = navRows[navRows.length - 1];
      if (last) onActiveNavIdChange(last.id);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitActive();
      return;
    }
    if (e.key === '/' && document.activeElement !== searchRef.current) {
      if (!showSearch) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(appPopoverPanelClassName, 'vx-capture-picker-panel')}
      role="menu"
      aria-label="Capture screenshot"
      aria-activedescendant={`capture-row-${activeNavId}`}
    >
      <header className="vx-capture-picker-header">
        <span className="vx-capture-picker-header__title">Capture</span>
        <span className="vx-capture-picker-header__hint">
          Attach a screenshot to your message
        </span>
      </header>

      {showSearch ? (
        <div className="vx-capture-picker-search">
          <TextField
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter windows…"
            aria-label="Filter capture sources"
          />
        </div>
      ) : null}

      <div className="vx-capture-picker-body">
        <ModelPickerSectionHeader label="Vyotiq" variant="pinned" />
        <CapturePickerRow
          rowId="app-window"
          label="This app window"
          subtitle="Current Vyotiq chat window"
          icon={AppWindow}
          disabled={capturing}
          active={activeNavId === 'app-window'}
          capturing={capturingRowId === 'app-window'}
          onFocus={() => onActiveNavIdChange('app-window')}
          onClick={onCaptureAppWindow}
        />

        {showSkeleton ? <CapturePickerSkeletonRows /> : null}

        {!showSkeleton && screens.length > 0 ? (
          <>
            <ModelPickerSectionHeader
              label="Displays"
              variant="category"
              count={screens.length}
            />
            {screens.map((source) => {
              const rowId = `screen:${source.id}`;
              return (
                <CapturePickerRow
                  key={source.id}
                  rowId={rowId}
                  label={source.name}
                  subtitle={captureNavSubtitle(source.id)}
                  thumbnailSrc={source.thumbnailDataUrl}
                  icon={Monitor}
                  disabled={capturing}
                  active={activeNavId === rowId}
                  capturing={capturingRowId === rowId}
                  onFocus={() => onActiveNavIdChange(rowId)}
                  onClick={() => onCaptureSource(source.id, rowId)}
                />
              );
            })}
          </>
        ) : null}

        {!showSkeleton && windows.length > 0 ? (
          <>
            <ModelPickerSectionHeader
              label="Windows"
              variant="category"
              count={windows.length}
            />
            {virtualizeWindows ? (
              <CapturePickerWindowList
                windows={windows}
                capturing={capturing}
                capturingRowId={capturingRowId}
                activeNavId={activeNavId}
                onActiveNavId={onActiveNavIdChange}
                onCaptureSource={onCaptureSource}
              />
            ) : (
              windows.map((source) => {
                const rowId = `window:${source.id}`;
                return (
                  <CapturePickerRow
                    key={source.id}
                    rowId={rowId}
                    label={source.name}
                    subtitle={captureNavSubtitle(source.id)}
                    thumbnailSrc={source.thumbnailDataUrl}
                    icon={AppWindow}
                    disabled={capturing}
                    active={activeNavId === rowId}
                    capturing={capturingRowId === rowId}
                    onFocus={() => onActiveNavIdChange(rowId)}
                    onClick={() => onCaptureSource(source.id, rowId)}
                  />
                );
              })
            )}
          </>
        ) : null}

        {!showSkeleton && !loading && !hasCatalog ? (
          <div className="vx-capture-picker-empty">
            <p>
              No other displays or windows were returned by the system. Use{' '}
              <strong>This app window</strong> above, or check screen-capture permissions in
              Windows Settings.
            </p>
            <button
              type="button"
              className="vx-capture-picker-empty__cta"
              onClick={() => void openCapturePermissionSettings()}
            >
              Open screen capture settings
            </button>
          </div>
        ) : null}

        {!showSkeleton && query && screens.length === 0 && windows.length === 0 && hasCatalog ? (
          <p className="vx-capture-picker-empty">No capture sources match your filter.</p>
        ) : null}
      </div>

      <footer className="vx-capture-picker-footer">
        {capturing ? (
          <span className="vx-capture-picker-footer__status">
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} aria-hidden />
            Capturing…
          </span>
        ) : loadingThumbnails ? (
          <span className="vx-capture-picker-footer__status">Loading previews…</span>
        ) : (
          <CapturePickerHints showSearchHint={showSearch} />
        )}
      </footer>
    </div>
  );
}
