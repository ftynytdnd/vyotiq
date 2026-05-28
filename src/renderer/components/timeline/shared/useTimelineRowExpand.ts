/**
 * Shared expand/collapse for timeline rows backed by `useTimelineUiStore`.
 *
 * Encapsulates persisted state, manual-override semantics, optional local
 * fallback (no rowKey), and live auto-expand (edit/diff streams only).
 */

import { useState } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';

export interface UseTimelineRowExpandOptions {
  /** Persisted row key; omit for ephemeral local-only expand. */
  rowKey?: string;
  /** When true and the user has not overridden, row renders expanded. */
  liveAutoExpand?: boolean;
  /** Default when no persistence and not live-expanding. */
  defaultExpanded?: boolean;
}

export interface UseTimelineRowExpandResult {
  expanded: boolean;
  onToggle: () => void;
  setExpanded: (value: boolean) => void;
  userOverridden: boolean;
}

export function useTimelineRowExpand({
  rowKey,
  liveAutoExpand = false,
  defaultExpanded = false
}: UseTimelineRowExpandOptions): UseTimelineRowExpandResult {
  const conversationId = useChatStore((s) => s.conversationId);
  const usePersisted = Boolean(rowKey && conversationId);
  const persistedExpanded = useTimelineUiStore((s) =>
    usePersisted ? s.isExpanded(conversationId, rowKey!) : false
  );
  const userOverridden = useTimelineUiStore((s) =>
    usePersisted ? s.hasManualOverride(conversationId, rowKey!) : false
  );
  const setExpandedPersisted = useTimelineUiStore((s) => s.setExpanded);
  const [localOpen, setLocalOpen] = useState(defaultExpanded);
  const [localOverride, setLocalOverride] = useState(false);

  const expanded = usePersisted
    ? userOverridden
      ? persistedExpanded
      : liveAutoExpand || persistedExpanded
    : localOverride
      ? localOpen
      : liveAutoExpand || localOpen;

  const setExpanded = (value: boolean) => {
    if (usePersisted) {
      setExpandedPersisted(conversationId!, rowKey!, value);
    } else {
      setLocalOverride(true);
      setLocalOpen(value);
    }
  };

  const onToggle = () => {
    setExpanded(!expanded);
  };

  return { expanded, onToggle, setExpanded, userOverridden };
}
