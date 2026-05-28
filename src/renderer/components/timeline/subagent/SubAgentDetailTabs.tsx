/**
 * SubAgentDetailTabs — tabbed Run / Brief / Result panels (focus modal).
 */

import { useMemo, useState } from 'react';
import type { SubAgentSnapshot } from '../reducer/types.js';
import { Tabs, type TabItem } from '../../ui/Tabs.js';
import { SubAgentHeader } from './SubAgentHeader.js';
import { SubAgentBriefing } from './briefing/SubAgentBriefing.js';
import { SubAgentRunFlow } from './SubAgentRunFlow.js';
import { SubAgentResult } from './SubAgentResult.js';
import { SubAgentArtifacts } from './SubAgentArtifacts.js';
import { cn } from '../../../lib/cn.js';
import { parseResultEnvelope } from '@shared/text/resultPatterns.js';

export type SubAgentDetailTab = 'run' | 'brief' | 'result';

interface SubAgentDetailTabsProps {
  snap: SubAgentSnapshot;
  /** Prefix for `aria-controls` panel ids (e.g. sub-agent id). */
  idPrefix: string;
  /** Initial tab when the panel mounts. */
  defaultTab?: SubAgentDetailTab;
  className?: string;
}

export function SubAgentDetailTabs({
  snap,
  idPrefix,
  defaultTab = 'run',
  className
}: SubAgentDetailTabsProps) {
  const hasOutput = typeof snap.output === 'string' && snap.output.trim().length > 0;
  const showResultTab =
    hasOutput || snap.status === 'failed' || snap.status === 'malformed';
  const [tab, setTab] = useState<SubAgentDetailTab>(defaultTab);

  const parsedOutput = useMemo(
    () => (hasOutput ? parseResultEnvelope(snap.output!) : null),
    [hasOutput, snap.output]
  );

  const items: TabItem<SubAgentDetailTab>[] = useMemo(
    () => [
      { id: 'run', label: 'Run', panelId: `sub-${idPrefix}-run` },
      { id: 'brief', label: 'Brief', panelId: `sub-${idPrefix}-brief` },
      ...(showResultTab
        ? [{ id: 'result' as const, label: 'Result', panelId: `sub-${idPrefix}-result` }]
        : [])
    ],
    [idPrefix, showResultTab]
  );

  const activeTab = items.some((i) => i.id === tab) ? tab : 'run';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <SubAgentHeader snap={snap} />
      <Tabs
        items={items}
        value={activeTab}
        onChange={setTab}
        variant="segmented"
        size="sm"
        ariaLabel="Sub-agent detail"
      />
      {activeTab === 'run' && (
        <div id={`sub-${idPrefix}-run`} role="tabpanel" className="flex flex-col gap-1.5">
          <SubAgentRunFlow snap={snap} />
        </div>
      )}
      {activeTab === 'brief' && (
        <div id={`sub-${idPrefix}-brief`} role="tabpanel" className="flex flex-col gap-1.5">
          <SubAgentBriefing snap={snap} />
          {parsedOutput && <SubAgentArtifacts parsed={parsedOutput} />}
        </div>
      )}
      {activeTab === 'result' && showResultTab && (
        <div id={`sub-${idPrefix}-result`} role="tabpanel" className="flex flex-col gap-1.5">
          <SubAgentResult
            output={snap.output ?? ''}
            omitArtifacts
            {...(parsedOutput ? { parsed: parsedOutput } : {})}
          />
        </div>
      )}
    </div>
  );
}
