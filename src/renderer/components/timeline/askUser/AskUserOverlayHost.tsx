/**
 * Hosts the floating AskUser overlay above the composer column.
 */

import { useShallow } from 'zustand/react/shallow';
import { ComposerDialogPortal } from '../../ui/ComposerDialogAnchor.js';
import { findPendingAskUserEvent } from '../../../lib/pendingAskUser.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { AskUserOverlay } from './AskUserOverlay.js';

export function AskUserOverlayHost() {
  const { awaitingAskUser, events } = useChatStore(
    useShallow((s) => ({
      awaitingAskUser: s.awaitingAskUser,
      events: s.events
    }))
  );
  const pending = findPendingAskUserEvent(events, awaitingAskUser);
  if (!pending || pending.status === 'submitted') return null;
  if (pending.source !== 'host-report-gate') return null;

  return (
    <ComposerDialogPortal>
      <AskUserOverlay pending={pending} />
    </ComposerDialogPortal>
  );
}
