/**
 * Capture picker state — prefetch, two-phase source listing, abort-safe capture.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAPTURE_PICKER_PREFETCH_DEBOUNCE_MS,
  CAPTURE_PICKER_SKELETON_DELAY_MS
} from '@shared/capture/capturePickerConstants.js';
import { mergeCaptureSources } from '@shared/capture/mergeCaptureSources.js';
import type { CaptureSourceInfo } from '@shared/types/capture.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { vyotiq } from '../../../lib/ipc.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { openCapturePermissionSettings } from '../../../lib/openCapturePermissionSettings.js';
import { waitForCompositorPaint } from '../../../lib/waitForCompositorPaint.js';
import { captureDesktopSourceFrame } from '../captureDesktopStream.js';
import { formatAttachmentIngestError } from '../formatAttachmentIngestError.js';
import { isStaleCaptureSourceError } from './capturePickerModel.js';

interface UseCapturePickerOptions {
  disabled?: boolean;
  conversationId: string | null;
  messageId: string;
  onIngested: (meta: PromptAttachmentMeta) => void;
}

export function useCapturePicker({
  disabled = false,
  conversationId,
  messageId,
  onIngested
}: UseCapturePickerOptions) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [capturingRowId, setCapturingRowId] = useState<string | null>(null);
  const [activeNavId, setActiveNavId] = useState<string>('app-window');
  const [query, setQuery] = useState('');
  const [suppressPickerUi, setSuppressPickerUi] = useState(false);

  const showToast = useToastStore((s) => s.show);
  const listGenerationRef = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const captureAbortRef = useRef<AbortController | null>(null);
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedRef = useRef(false);

  const clearSkeletonTimer = useCallback(() => {
    if (skeletonTimerRef.current) {
      clearTimeout(skeletonTimerRef.current);
      skeletonTimerRef.current = null;
    }
  }, []);

  const abortListLoad = useCallback(() => {
    listGenerationRef.current += 1;
    listAbortRef.current?.abort();
    listAbortRef.current = null;
    clearSkeletonTimer();
    setShowSkeleton(false);
  }, [clearSkeletonTimer]);

  const abortCapture = useCallback(() => {
    captureAbortRef.current?.abort();
    captureAbortRef.current = null;
    setCapturing(false);
    setCapturingRowId(null);
  }, []);

  const cleanupOnClose = useCallback(() => {
    abortListLoad();
    abortCapture();
    setLoading(false);
    setLoadingThumbnails(false);
    setQuery('');
    setActiveNavId('app-window');
    setSuppressPickerUi(false);
  }, [abortCapture, abortListLoad]);

  const showCapturePermissionToast = useCallback(() => {
    showToast('Screen capture permission denied. Open system Settings to allow capture.', 'danger');
    void openCapturePermissionSettings();
  }, [showToast]);

  const ingestCapturePath = useCallback(
    async (relPath: string) => {
      const workspaceId = useWorkspaceStore.getState().activeId;
      if (!workspaceId || !conversationId) {
        showToast('Open a workspace and conversation first.', 'danger');
        return false;
      }
      try {
        const ingested = await vyotiq.attachments.ingestPaths({
          paths: [relPath],
          workspaceId,
          conversationId,
          messageId
        });
        if (ingested.length === 0) {
          showToast('Capture could not be attached.', 'danger');
          return false;
        }
        onIngested(ingested[0]!);
        setOpen(false);
        showToast('Capture attached.', 'success');
        return true;
      } catch (err) {
        showToast(formatAttachmentIngestError(err), 'danger');
        return false;
      }
    },
    [conversationId, messageId, onIngested, showToast]
  );

  const ingestCaptureFrame = useCallback(
    async (png: Uint8Array, width: number, height: number, prefix: string) => {
      const workspaceId = useWorkspaceStore.getState().activeId;
      if (!workspaceId || !conversationId) {
        showToast('Open a workspace and conversation first.', 'danger');
        return false;
      }
      const result = await vyotiq.capture.ingestFrame({
        workspaceId,
        conversationId,
        messageId,
        png,
        width,
        height,
        prefix
      });
      return ingestCapturePath(result.relPath);
    },
    [conversationId, ingestCapturePath, messageId, showToast]
  );

  const loadSources = useCallback(
    async (opts?: { force?: boolean }) => {
      abortListLoad();
      const generation = listGenerationRef.current;
      const abort = new AbortController();
      listAbortRef.current = abort;

      setLoading(true);
      skeletonTimerRef.current = setTimeout(() => {
        if (generation === listGenerationRef.current) setShowSkeleton(true);
      }, CAPTURE_PICKER_SKELETON_DELAY_MS);

      try {
        const { sources: fast } = await vyotiq.capture.listSources({ thumbnails: false });
        if (abort.signal.aborted || generation !== listGenerationRef.current) return;
        setSources(fast);
        setLoading(false);
        clearSkeletonTimer();
        setShowSkeleton(false);
        prefetchedRef.current = true;

        setLoadingThumbnails(true);
        const { sources: withThumbs } = await vyotiq.capture.listSources({ thumbnails: true });
        if (abort.signal.aborted || generation !== listGenerationRef.current) return;
        setSources((prev) => mergeCaptureSources(prev, withThumbs));
      } catch (err) {
        if (abort.signal.aborted || generation !== listGenerationRef.current) return;
        if (!opts?.force) return;
        showToast(err instanceof Error ? err.message : 'Could not list capture sources.', 'danger');
      } finally {
        if (generation === listGenerationRef.current) {
          setLoading(false);
          setLoadingThumbnails(false);
          clearSkeletonTimer();
          setShowSkeleton(false);
          listAbortRef.current = null;
        }
      }
    },
    [abortListLoad, clearSkeletonTimer, showToast, sources.length]
  );

  const prefetchSources = useCallback(() => {
    if (disabled || prefetchedRef.current || open) return;
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null;
      if (prefetchedRef.current || open) return;
      void vyotiq.capture.listSources({ thumbnails: false }).then(({ sources: fast }) => {
        prefetchedRef.current = true;
        if (!open) setSources(fast);
      }).catch(() => {
        /* prefetch is best-effort */
      });
    }, CAPTURE_PICKER_PREFETCH_DEBOUNCE_MS);
  }, [disabled, open]);

  const cancelPrefetch = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) cleanupOnClose();
  }, [cleanupOnClose, open]);

  useEffect(() => {
    return () => {
      cancelPrefetch();
      abortListLoad();
      abortCapture();
    };
  }, [abortCapture, abortListLoad, cancelPrefetch]);

  const openPicker = useCallback(() => {
    if (disabled || capturing) return;
    setOpen(true);
    setQuery('');
    setActiveNavId('app-window');
    if (sources.length === 0) {
      void loadSources();
    } else {
      void loadSources();
    }
  }, [capturing, disabled, loadSources, sources.length]);

  const closePicker = useCallback(() => {
    setOpen(false);
  }, []);

  const togglePicker = useCallback(() => {
    if (open) closePicker();
    else openPicker();
  }, [closePicker, open, openPicker]);

  const hidePickerForCapture = useCallback(async () => {
    setSuppressPickerUi(true);
    await waitForCompositorPaint();
  }, []);

  const captureAppWindow = useCallback(async () => {
    const workspaceId = useWorkspaceStore.getState().activeId;
    if (!workspaceId || !conversationId) {
      showToast('Open a workspace and conversation first.', 'danger');
      return;
    }
    abortCapture();
    const abort = new AbortController();
    captureAbortRef.current = abort;
    setCapturing(true);
    setCapturingRowId('app-window');
    try {
      await hidePickerForCapture();
      if (abort.signal.aborted) return;
      const result = await vyotiq.capture.window({ workspaceId });
      if (abort.signal.aborted) return;
      await ingestCapturePath(result.relPath);
    } catch (err) {
      if (abort.signal.aborted) return;
      setSuppressPickerUi(false);
      showToast(formatAttachmentIngestError(err), 'danger');
    } finally {
      if (captureAbortRef.current === abort) {
        captureAbortRef.current = null;
        setCapturing(false);
        setCapturingRowId(null);
      }
    }
  }, [abortCapture, conversationId, hidePickerForCapture, ingestCapturePath, showToast]);

  const captureSource = useCallback(
    async (sourceId: string, rowId: string) => {
      abortCapture();
      const abort = new AbortController();
      captureAbortRef.current = abort;
      setCapturing(true);
      setCapturingRowId(rowId);
      try {
        await hidePickerForCapture();
        if (abort.signal.aborted) return;
        const frame = await captureDesktopSourceFrame(sourceId, abort.signal);
        if (abort.signal.aborted) return;
        await ingestCaptureFrame(frame.png, frame.width, frame.height, 'screen');
      } catch (err) {
        if (abort.signal.aborted) return;
        setSuppressPickerUi(false);
        const msg = err instanceof Error ? err.message : 'Capture failed.';
        if (/permission|denied|not allowed/i.test(msg)) {
          showCapturePermissionToast();
          return;
        }
        if (isStaleCaptureSourceError(err)) {
          showToast('That window closed or moved. Refreshing the list…', 'info');
          void loadSources({ force: true });
          return;
        }
        showToast(formatAttachmentIngestError(err), 'danger');
      } finally {
        if (captureAbortRef.current === abort) {
          captureAbortRef.current = null;
          setCapturing(false);
          setCapturingRowId(null);
        }
      }
    },
    [
      abortCapture,
      hidePickerForCapture,
      ingestCaptureFrame,
      loadSources,
      showCapturePermissionToast,
      showToast
    ]
  );

  return {
    open,
    pickerVisible: open && !suppressPickerUi,
    sources,
    loading,
    showSkeleton,
    loadingThumbnails,
    capturing,
    capturingRowId,
    activeNavId,
    setActiveNavId,
    query,
    setQuery,
    togglePicker,
    closePicker,
    prefetchSources,
    cancelPrefetch,
    loadSources,
    captureAppWindow,
    captureSource
  };
}
