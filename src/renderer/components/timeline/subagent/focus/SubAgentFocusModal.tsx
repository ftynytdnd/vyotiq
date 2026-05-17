/**
 * SubAgentFocusModal — full-pane viewer for ONE sub-agent.
 *
 * Reuses the Briefing + RunFlow + Result components verbatim so the
 * focus mode is structurally identical to the inline trace card —
 * just larger, scrollable on its own surface, and with the rest of
 * the timeline visually backgrounded.
 *
 * Layout note: `SubAgentHeader` already renders its own `Bot` icon
 * + id + status + usage row, and the `Modal` title bar carries the
 * `Sub-agent {id} — {task}` label. We render `SubAgentHeader`
 * verbatim (no extra Bot-chrome wrapper) so the modal body doesn't
 * stack two Bot icons + duplicate the id row.
 *
 * Mounted inline on the trace; the parent's `useSubAgentFocus` hook
 * owns the open/close state. The underlying `Modal` primitive
 * handles the body-scroll lock, focus trap, Esc handling, and focus
 * restoration to whichever element opened the modal.
 */

import type { SubAgentSnapshot } from '../../reducer/types.js';
import { Modal } from '../../../ui/Modal.js';
import { SubAgentBriefing } from '../briefing/SubAgentBriefing.js';
import { SubAgentRunFlow } from '../SubAgentRunFlow.js';
import { SubAgentResult } from '../SubAgentResult.js';
import { SubAgentHeader } from '../SubAgentHeader.js';

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
  const hasOutput = typeof snap.output === 'string' && snap.output.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <div className="flex flex-col gap-4">
        <SubAgentHeader snap={snap} />
        <SubAgentBriefing snap={snap} />
        <div className="flex flex-col gap-2">
          <div className="text-meta font-medium uppercase tracking-wider text-text-faint">
            Execution
          </div>
          <SubAgentRunFlow snap={snap} />
        </div>
        {hasOutput && (
          <div className="flex flex-col gap-2">
            <div className="text-meta font-medium uppercase tracking-wider text-text-faint">
              Result
            </div>
            <SubAgentResult output={snap.output!} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function trimTitle(s: string, max: number): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}
