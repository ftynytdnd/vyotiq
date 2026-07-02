/**
 * Source control branch picker — local branches or GitHub branch panel.
 */

import { cn } from '../../lib/cn.js';
import { BranchPickerPanel } from '../composer/branchPicker/ComposerBranchChip.js';

interface SourceControlBranchPanelProps {
  workspaceId: string;
  branches: Array<{ name: string; current: boolean }>;
  githubBound: boolean;
  onCheckout: (branch: string) => void;
  onCreateBranch: () => void;
  onClose: () => void;
}

export function SourceControlBranchPanel({
  workspaceId,
  branches,
  githubBound,
  onCheckout,
  onCreateBranch,
  onClose
}: SourceControlBranchPanelProps) {
  if (githubBound) {
    return (
      <div className="vx-sc-branch-panel vx-sc-branch-panel--github scrollbar-stealth">
        <BranchPickerPanel workspaceId={workspaceId} onClose={onClose} />
      </div>
    );
  }

  return (
    <div className="vx-sc-branch-panel scrollbar-stealth" role="listbox" aria-label="Branches">
      <div className="vx-sc-branch-panel-head">
        <span className="vx-sc-branch-panel-title">Switch branch</span>
      </div>
      <div className="vx-sc-branch-panel-list">
        {branches.map((b) => (
          <button
            key={b.name}
            type="button"
            role="option"
            aria-selected={b.current}
            className={cn('vx-sc-branch-row', b.current && 'vx-sc-branch-row--current')}
            onClick={() => onCheckout(b.name)}
          >
            <span className="truncate">{b.name}</span>
            {b.current ? <span className="vx-sc-branch-row-badge">current</span> : null}
          </button>
        ))}
        <button
          type="button"
          className="vx-sc-branch-row vx-sc-branch-row--create"
          onClick={onCreateBranch}
        >
          + Create branch…
        </button>
      </div>
    </div>
  );
}
