/**
 * Auto-opened floating diff while a file edit streams in the timeline.
 */

import { FloatingPanel } from '../ui/FloatingPanel.js';
import { EditDiffView } from './tools/edit/EditDiffView.js';
import { DiffStatsBadge } from './tools/shared/DiffStatsBadge.js';
import { usePersistedPanelWidth } from '../../hooks/usePersistedPanelWidth.js';
import type { FloatingLiveDiffTarget } from '../../store/useFloatingLiveDiffStore.js';

interface LiveDiffFloatingPanelProps {
  target: FloatingLiveDiffTarget | null;
  onClose: () => void;
}

export function LiveDiffFloatingPanel({ target, onClose }: LiveDiffFloatingPanelProps) {
  const { initialWidth, onWidthChange } = usePersistedPanelWidth('liveDiff');
  if (!target) return null;
  const { diffStream, filePath } = target;
  const settled = diffStream.settled === true;

  return (
    <FloatingPanel
      open
      onClose={onClose}
      title={filePath}
      widthKey="liveDiff"
      initialWidth={initialWidth}
      onWidthChange={onWidthChange}
      showBackdrop={false}
      className="vx-live-diff-panel"
    >
      <div className="mb-2 flex items-center gap-2 text-row text-text-muted">
        <span className="font-mono truncate" title={filePath}>
          {filePath}
        </span>
        <DiffStatsBadge
          additions={diffStream.additions}
          deletions={diffStream.deletions}
          pending={!settled}
        />
      </div>
      <EditDiffView
        key={settled ? 'live-diff-settled' : 'live-diff-stream'}
        hunks={diffStream.hunks}
        variant={settled ? 'authoritative' : 'partial'}
        maxHeightClass="max-h-[min(70vh,36rem)]"
      />
    </FloatingPanel>
  );
}
