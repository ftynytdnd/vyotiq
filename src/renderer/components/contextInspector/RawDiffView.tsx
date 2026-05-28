/**
 * Raw before / after / dropped tabbed view for any completed summary.
 *
 * Visual contract: matches `CheckpointsView`'s tab strip exactly —
 * a row of `app-no-drag rounded-inner px-2.5 py-1` buttons with
 * {@link chromeTabActiveClassName} for the active tab and ghost idle
 * tabs (via shared `Tabs` strip variant). Body uses the
 * same `bg-surface-raised/60` monospace pre block the inline
 * timeline row already uses, so the same compressed body looks
 * identical whether the user reads it in the timeline or the
 * Inspector.
 */

import { useState } from 'react';
import { useChatStore } from '../../store/useChatStore.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { SurfaceShell } from '../ui/SurfaceShell.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import type { ContextSummaryAcc } from '../timeline/reducer/types.js';

interface RawDiffViewProps {
  summaryId: string;
}

type Tab = 'after' | 'before' | 'dropped';

const TABS: TabItem<Tab>[] = [
  { id: 'after', label: 'Final summary' },
  { id: 'before', label: 'Replaced ids' },
  { id: 'dropped', label: 'Dropped ids' }
];

export function RawDiffView({ summaryId }: RawDiffViewProps) {
  const acc: ContextSummaryAcc | undefined = useChatStore(
    (s) => s.summaries[summaryId]
  );
  const [tab, setTab] = useState<Tab>('after');
  if (!acc) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3">
      <div className="flex items-center gap-1">
        <Eyebrow as="span" bold className="mr-2">
          Most recent summary
        </Eyebrow>
        <Tabs<Tab>
          items={TABS}
          value={tab}
          onChange={setTab}
          variant="strip"
          ariaLabel="Summary diff view"
        />
      </div>
      {tab === 'after' && (
        <div className="flex flex-col gap-1">
          {acc.status === 'aborted' ? (
            <span className="text-row text-danger">
              {acc.reason ?? 'Summarization failed.'}
            </span>
          ) : (
            <SurfaceShell padded padding="nested">
              <pre className="scrollbar-stealth max-h-[36vh] overflow-y-auto whitespace-pre-wrap break-words font-mono text-row text-text-secondary">
                {acc.finalText ?? acc.text}
              </pre>
            </SurfaceShell>
          )}
        </div>
      )}
      {tab === 'before' && (
        <div className="flex flex-col gap-1">
          <span className="text-meta text-text-faint">
            {acc.replacedMessageIds.length} message
            {acc.replacedMessageIds.length === 1 ? '' : 's'} replaced
          </span>
          {acc.replacedMessageIds.length === 0 ? (
            <span className="text-row text-text-muted">No messages were replaced.</span>
          ) : (
            <SurfaceShell padded padding="nested" className="scrollbar-stealth max-h-[24vh] overflow-y-auto">
              <ul className="flex flex-col gap-0.5">
              {acc.replacedMessageIds.map((id) => (
                <li
                  key={id}
                  className="font-mono text-meta text-text-secondary"
                  title={id}
                >
                  {id}
                </li>
              ))}
              </ul>
            </SurfaceShell>
          )}
        </div>
      )}
      {tab === 'dropped' && (
        <div className="flex flex-col gap-1">
          <span className="text-meta text-text-faint">
            {acc.droppedMessageIds.length} message
            {acc.droppedMessageIds.length === 1 ? '' : 's'} dropped
          </span>
          {acc.droppedMessageIds.length === 0 ? (
            <span className="text-row text-text-muted">No messages were dropped.</span>
          ) : (
            <SurfaceShell padded padding="nested" className="scrollbar-stealth max-h-[24vh] overflow-y-auto">
              <ul className="flex flex-col gap-0.5">
              {acc.droppedMessageIds.map((id) => (
                <li
                  key={id}
                  className="font-mono text-meta text-text-secondary"
                  title={id}
                >
                  {id}
                </li>
              ))}
              </ul>
            </SurfaceShell>
          )}
        </div>
      )}
    </div>
  );
}
