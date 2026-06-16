/**
 * Embedded web browser (Globe) state. The actual page renders in a
 * main-process `WebContentsView`; this store mirrors its navigation
 * state and drives open/close + the workbench tab.
 */

import { create } from 'zustand';
import type { BrowserStateEvent } from '@shared/types/browser.js';
import { vyotiq } from '../lib/ipc.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import {
  focusWorkbenchTab,
  syncWorkbenchTabAfterClose
} from '../components/workbench/workbenchShared.js';

interface BrowserStore {
  open: boolean;
  /** Last URL committed in the view. */
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
  /** Whether any page has been loaded this session (drives empty state). */
  hasLoaded: boolean;
  /** Find-in-page overlay visibility. */
  findOpen: boolean;
  setFindOpen: (open: boolean) => void;
  openPanel: (url?: string) => Promise<void>;
  navigate: (input: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  close: () => void;
  applyState: (state: BrowserStateEvent) => void;
}

/**
 * Best-effort URL normalization: bare domains/localhost get `https://`,
 * anything that doesn't look like a URL becomes a web search.
 */
export function normalizeBrowserInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^(about|data|file):/i.test(trimmed)) return trimmed;
  const looksLikeHost =
    /^localhost(:\d+)?(\/.*)?$/i.test(trimmed) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed) ||
    (/^[^\s]+\.[^\s]{2,}/.test(trimmed) && !trimmed.includes(' '));
  if (looksLikeHost) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export const useBrowserStore = create<BrowserStore>((set, get) => ({
  open: false,
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  hasLoaded: false,
  findOpen: false,

  setFindOpen: (open) => set({ findOpen: open }),

  openPanel: async (url) => {
    closeSettingsForCompanionOpen();
    useAttachmentPreviewStore.getState().close();
    focusWorkbenchTab('browser');
    set({ open: true, error: null });
    try {
      const target = url ? normalizeBrowserInput(url) : undefined;
      const reply = await vyotiq.browser.attach(target ? { url: target } : undefined);
      set({
        url: reply.state.url,
        title: reply.state.title,
        loading: reply.state.loading,
        canGoBack: reply.state.canGoBack,
        canGoForward: reply.state.canGoForward,
        error: reply.state.error ?? null,
        hasLoaded: reply.state.url.length > 0 && reply.state.url !== 'about:blank'
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ open: false, error: msg });
      syncWorkbenchTabAfterClose();
    }
  },

  navigate: (input) => {
    const target = normalizeBrowserInput(input);
    if (!target) return;
    set({ loading: true, error: null, hasLoaded: true });
    void vyotiq.browser.navigate({ url: target });
  },

  back: () => void vyotiq.browser.back(),
  forward: () => void vyotiq.browser.forward(),
  reload: () => void vyotiq.browser.reload(),
  stop: () => void vyotiq.browser.stop(),

  close: () => {
    set({ open: false, findOpen: false });
    void vyotiq.browser.setVisible({ visible: false }).catch(() => {});
    syncWorkbenchTabAfterClose();
  },

  applyState: (state) => {
    set({
      url: state.url,
      title: state.title,
      loading: state.loading,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      error: state.error ?? null,
      hasLoaded: get().hasLoaded || (state.url.length > 0 && state.url !== 'about:blank')
    });
  }
}));
