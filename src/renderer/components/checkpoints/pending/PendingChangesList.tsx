/**
 * PendingChangesList — scrollable body of the pending-changes panel.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { PendingChangeFileGroup } from './PendingChangeFileGroup.js';
import { PendingChangesListHeader } from './PendingFileRowShell.js';
import {
  groupByFilePath,
  groupByFolder,
  groupByRun,
  type FolderBucket,
  type RunBucket
} from './groupPendingByPath.js';
import {
  pendingExpandButtonClassName,
  pendingFileRowGridTemplate,
  pendingPanelListClassName,
  pendingRunGroupHeaderClassName
} from './pendingPanelStyles.js';
import { timelineRowChevronClassName, timelineRowChevronStroke } from '../../timeline/shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';

const VIRTUALIZATION_THRESHOLD = 60;

interface PendingChangesListProps {
  pending: readonly PendingChange[];
  groupByFolderMode?: boolean;
}

export function PendingChangesList({
  pending,
  groupByFolderMode = false
}: PendingChangesListProps) {
  const folderGroups = useMemo(
    () => (groupByFolderMode ? groupByFolder(pending) : []),
    [groupByFolderMode, pending]
  );
  const groups = useMemo(() => groupByRun(pending), [pending]);
  const singleRunFileGroups = useMemo(
    () => (groups.length === 1 ? groupByFilePath(groups[0]!.entries) : []),
    [groups]
  );
  const shouldVirtualise = pending.length > VIRTUALIZATION_THRESHOLD;

  if (groupByFolderMode && folderGroups.length > 0) {
    return (
      <>
        <PendingChangesListHeader />
        <div className={pendingPanelListClassName}>
          {folderGroups.map((bucket) => (
            <FolderGroup key={bucket.folder || '(root)'} bucket={bucket} virtualise={shouldVirtualise} />
          ))}
        </div>
      </>
    );
  }

  if (groups.length === 1) {
    return (
      <>
        <PendingChangesListHeader />
        <div className={pendingPanelListClassName}>
          {singleRunFileGroups.map((g) => (
            <PendingChangeFileGroup
              key={g.filePath}
              entries={g.entries}
              virtualise={shouldVirtualise}
              RowFrame={RowFrame}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PendingChangesListHeader />
      <div className={pendingPanelListClassName}>
      {groups.map((g) => (
        <RunGroup key={g.runId} group={g} virtualise={shouldVirtualise} />
      ))}
      </div>
    </>
  );
}

function FolderGroup({
  bucket,
  virtualise
}: {
  bucket: FolderBucket;
  virtualise: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const fileGroups = groupByFilePath(bucket.entries);
  const label = bucket.folder.length > 0 ? bucket.folder : '(root)';
  const additions = bucket.entries.reduce((a, e) => a + e.additions, 0);
  const deletions = bucket.entries.reduce((a, e) => a + e.deletions, 0);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(pendingRunGroupHeaderClassName, 'grid', pendingFileRowGridTemplate)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse folder group' : 'Expand folder group'}
      >
        <span className={pendingExpandButtonClassName}>
          {expanded ? (
            <ChevronDown className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
          ) : (
            <ChevronRight className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
          )}
        </span>
        <span className="min-w-0 truncate font-mono normal-case tracking-normal text-text-muted">
          {label} · {fileGroups.length} file{fileGroups.length === 1 ? '' : 's'}
        </span>
        <span className="justify-self-end font-mono tabular-nums text-text-faint">
          +{additions} −{deletions}
        </span>
        <span aria-hidden />
      </button>
      {expanded && (
        <div className={pendingPanelListClassName}>
          {fileGroups.map((fileGroup) => (
            <PendingChangeFileGroup
              key={fileGroup.filePath}
              entries={fileGroup.entries}
              virtualise={virtualise}
              RowFrame={RowFrame}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunGroup({
  group,
  virtualise
}: {
  group: RunBucket;
  virtualise: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const fileGroups = groupByFilePath(group.entries);
  const additions = group.entries.reduce((a, e) => a + e.additions, 0);
  const deletions = group.entries.reduce((a, e) => a + e.deletions, 0);
  const fileCount = fileGroups.length;
  const editCount = group.entries.length;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(pendingRunGroupHeaderClassName, 'grid', pendingFileRowGridTemplate)}
        aria-label={expanded ? 'Collapse run group' : 'Expand run group'}
        aria-expanded={expanded}
      >
        <span className={pendingExpandButtonClassName}>
          {expanded ? (
            <ChevronDown className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
          ) : (
            <ChevronRight className={timelineRowChevronClassName} strokeWidth={timelineRowChevronStroke} />
          )}
        </span>
        <span className="min-w-0 truncate font-mono normal-case tracking-normal text-text-muted">
          run {group.runId.slice(0, 8)}
          {fileCount < editCount
            ? ` · ${fileCount} files · ${editCount} edits`
            : ` · ${editCount} change${editCount === 1 ? '' : 's'}`}
        </span>
        <span className="justify-self-end font-mono tabular-nums text-text-faint">
          +{additions} −{deletions}
        </span>
        <span aria-hidden />
      </button>
      {expanded && (
        <div className={pendingPanelListClassName}>
          {fileGroups.map((fileGroup) => (
            <PendingChangeFileGroup
              key={fileGroup.filePath}
              entries={fileGroup.entries}
              virtualise={virtualise}
              RowFrame={RowFrame}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RowFrame({
  virtualise,
  children
}: {
  virtualise: boolean;
  children: ReactNode;
}) {
  if (!virtualise) return <>{children}</>;
  return <LazyMountRow>{children}</LazyMountRow>;
}

function LazyMountRow({ children }: { children: ReactNode }) {
  const [shouldMount, setShouldMount] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (shouldMount) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShouldMount(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldMount(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: '120px 0px' }
    );
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [shouldMount]);

  return (
    <div ref={ref} className="min-h-7">
      {shouldMount ? children : null}
    </div>
  );
}
