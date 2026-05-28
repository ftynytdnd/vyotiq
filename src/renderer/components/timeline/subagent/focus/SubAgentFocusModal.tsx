/**
 * SubAgentFocusModal — full-pane viewer for ONE sub-agent.
 *
 * Reuses `SubAgentDetailTabs` for Run / Brief / Result in a large modal
 * surface; the timeline row stays a single collapsed delegation line.
 *
 * Mounted inline on the trace; the parent's `useSubAgentFocus` hook
 * owns the open/close state. The underlying `Modal` primitive
 * handles the body-scroll lock, focus trap, Esc handling, and focus
 * restoration to whichever element opened the modal.
 */

import type { SubAgentSnapshot } from '../../reducer/types.js';
import { Modal } from '../../../ui/Modal.js';
import { SurfaceShell, surfaceShellInnerClassName } from '../../../ui/SurfaceShell.js';
import { SubAgentDetailTabs } from '../SubAgentDetailTabs.js';

interface SubAgentFocusModalProps {
  open: boolean;
  onClose: () => void;
  snap: SubAgentSnapshot;
}

export function SubAgentFocusModal({
  open,
  onClose,
  snap
}: SubAgentFocusModalProps) {
  const title = snap.task.trim().length > 0
    ? `Sub-agent ${snap.id} — ${trimTitle(snap.task, 80)}`
    : `Sub-agent ${snap.id}`;

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <SurfaceShell className={surfaceShellInnerClassName('content')}>
        <SubAgentDetailTabs snap={snap} idPrefix={`focus-${snap.id}`} />
      </SurfaceShell>
    </Modal>
  );
}

function trimTitle(s: string, max: number): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}
