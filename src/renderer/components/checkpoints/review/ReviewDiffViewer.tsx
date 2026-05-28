/**
 * Read-only diff viewer for checkpoint review (no PR comments or decisions).
 */

import { useEffect, useMemo, useState } from 'react';
import type { GitRefOption, PendingChange } from '@shared/types/checkpoint.js';
import { vyotiq } from '../../../lib/ipc.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { Dropdown, type DropdownItem } from '../../ui/Dropdown.js';
import { LoadingHint } from '../../ui/LoadingHint.js';
import { PendingChangeDiff } from '../PendingChangeDiff.js';
import { PendingChangePathLabel } from '../shared/PendingChangeAttribution.js';
import { DiffStatsBadge } from '../../timeline/tools/shared/DiffStatsBadge.js';
import {
  chromeInsetNoteClassName,
  appComposerShellClassName
} from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { parseUnifiedPatch } from '@shared/text/diff/parseUnifiedPatch.js';
import { UnifiedDiffPanel } from '../../diff/UnifiedDiffPanel.js';
import { CodeBlock } from '../../timeline/tools/shared/CodeBlock.js';

interface ReviewDiffViewerProps {
  change: PendingChange;
  diffMaxHeightClass?: string;
}

function gitRefGroupLabel(group: GitRefOption['group']): string {
  if (group === 'builtin') return 'Built-in';
  if (group === 'local') return 'Local';
  return 'Remote';
}

export function ReviewDiffViewer({
  change,
  diffMaxHeightClass = 'max-h-[min(70vh,42rem)]'
}: ReviewDiffViewerProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const [gitOn, setGitOn] = useState(false);
  const [gitRef, setGitRef] = useState('HEAD');
  const [gitRefItems, setGitRefItems] = useState<DropdownItem[]>([
    { value: 'HEAD', label: 'HEAD', group: 'Built-in' }
  ]);
  const [gitRefsLoading, setGitRefsLoading] = useState(false);
  const [gitPatch, setGitPatch] = useState<string | null>(null);
  const [gitNote, setGitNote] = useState<string | null>(null);
  const [gitLoading, setGitLoading] = useState(false);

  useEffect(() => {
    if (!gitOn || !workspaceId) {
      setGitRefItems([{ value: 'HEAD', label: 'HEAD', group: 'Built-in' }]);
      return;
    }
    let cancelled = false;
    setGitRefsLoading(true);
    void vyotiq.checkpoints.listGitRefs(workspaceId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const items: DropdownItem[] = result.options.map((opt) => ({
          value: opt.ref,
          label: opt.ref,
          group: gitRefGroupLabel(opt.group)
        }));
        setGitRefItems(items.length > 0 ? items : [{ value: 'HEAD', label: 'HEAD', group: 'Built-in' }]);
        const hasCurrent = items.some((i) => i.value === gitRef);
        if (!hasCurrent) {
          const preferred =
            items.find((i) => i.value === result.head)?.value ??
            items.find((i) => i.value === 'HEAD')?.value ??
            items[0]?.value;
          if (preferred) setGitRef(preferred);
        }
      } else {
        setGitRefItems([{ value: 'HEAD', label: 'HEAD', group: 'Built-in' }]);
      }
    }).finally(() => {
      if (!cancelled) setGitRefsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [gitOn, workspaceId]);

  useEffect(() => {
    if (!gitOn || !workspaceId) {
      setGitPatch(null);
      setGitNote(null);
      return;
    }
    let cancelled = false;
    setGitLoading(true);
    void vyotiq.checkpoints
      .gitBaseDiff(workspaceId, change.filePath, gitRef.trim() || 'HEAD')
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setGitPatch(result.patch);
          setGitNote(`vs ${result.ref}`);
        } else {
          setGitPatch(null);
          setGitNote(
            result.reason === 'not-a-repo'
              ? 'Not a git repository'
              : result.reason === 'empty'
                ? 'No diff vs base'
                : result.message ?? result.reason
          );
        }
      })
      .finally(() => {
        if (!cancelled) setGitLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gitOn, workspaceId, change.filePath, gitRef]);

  const gitHunks = useMemo(
    () => (gitPatch ? parseUnifiedPatch(gitPatch) : []),
    [gitPatch]
  );

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <PendingChangePathLabel change={change} />
        <DiffStatsBadge additions={change.additions} deletions={change.deletions} />
      </div>
      <PendingChangeDiff
        workspaceId={change.workspaceId}
        kind={change.kind}
        {...(change.preHash ? { preHash: change.preHash } : {})}
        {...(change.postHash ? { postHash: change.postHash } : {})}
        maxHeightClass={diffMaxHeightClass}
      />
      <label className="inline-flex items-center gap-1.5 text-meta text-text-secondary">
        <input
          type="checkbox"
          checked={gitOn}
          onChange={(e) => setGitOn(e.target.checked)}
          className="rounded-inner"
        />
        Compare to git base
      </label>
      {gitOn && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[8rem] flex-1 flex-col gap-0.5">
            <span className="vx-field-label mb-0">Git base ref</span>
            <Dropdown
              items={gitRefItems}
              value={gitRef}
              onChange={setGitRef}
              placeholder="HEAD"
              disabled={gitRefsLoading}
            />
          </label>
        </div>
      )}
      {gitOn && (
        <div className={cn(appComposerShellClassName, 'overflow-hidden')}>
          {gitLoading && <LoadingHint message="Loading git diff…" />}
          {!gitLoading && gitNote && !gitPatch && (
            <div className={cn(chromeInsetNoteClassName, 'text-meta text-text-faint')}>
              {gitNote}
            </div>
          )}
          {!gitLoading && gitPatch && (
            <>
              {gitNote && <div className="px-2 py-1 vx-caption">{gitNote}</div>}
              {gitHunks.length > 0 ? (
                <UnifiedDiffPanel
                  hunks={gitHunks}
                  variant="authoritative"
                  maxHeightClass="max-h-48"
                />
              ) : (
                <CodeBlock body={gitPatch} tone="muted" maxHeight={192} />
              )}
            </>
          )}
        </div>
      )}
      <p className={cn(chromeInsetNoteClassName, 'text-meta text-text-faint')}>
        Read-only review. Accept or reject from the timeline pending row or pending list.
      </p>
    </div>
  );
}
