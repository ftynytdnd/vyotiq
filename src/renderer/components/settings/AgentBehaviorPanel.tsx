/**
 * Settings → Agent behavior — section sub-navigation + single active panel.
 */

import { useState } from 'react';
import { MemoryPanel } from './MemoryPanel.js';
import { VectorMemoryPanel } from './VectorMemoryPanel.js';
import { EditorLspPanel } from './EditorLspPanel.js';
import { PromptCachingPanel } from './PromptCachingPanel.js';
import { ReportsPanel } from './ReportsPanel.js';
import { RunLimitsPanel } from './RunLimitsPanel.js';
import { ContextManagementPanel } from './ContextManagementPanel.js';
import { CheckpointsPanel } from './CheckpointsPanel.js';
import { HarnessPanel } from './HarnessPanel.js';
import { InlineCompletionPanel } from './InlineCompletionPanel.js';
import { ScheduledRunsPanel } from './ScheduledRunsPanel.js';
import { LeftSubnav, type LeftSubnavItem } from '../ui/LeftSubnav.js';
import { ShellStack } from '../ui/ShellSection.js';

export type AgentBehaviorSectionId =
  | 'memory'
  | 'vector'
  | 'lsp'
  | 'inline-completion'
  | 'run-limits'
  | 'context'
  | 'harness'
  | 'checkpoints'
  | 'prompt-caching'
  | 'reports'
  | 'scheduled-runs';

const SECTION_ITEMS: LeftSubnavItem<AgentBehaviorSectionId>[] = [
  { id: 'memory', label: 'Memory', tabId: 'agent-tab-memory', panelId: 'agent-panel-memory' },
  { id: 'vector', label: 'Vector memory', tabId: 'agent-tab-vector', panelId: 'agent-panel-vector' },
  { id: 'lsp', label: 'Editor LSP', tabId: 'agent-tab-lsp', panelId: 'agent-panel-lsp' },
  {
    id: 'inline-completion',
    label: 'Inline completion',
    tabId: 'agent-tab-inline',
    panelId: 'agent-panel-inline'
  },
  { id: 'run-limits', label: 'Run limits', tabId: 'agent-tab-limits', panelId: 'agent-panel-limits' },
  {
    id: 'context',
    label: 'Context management',
    tabId: 'agent-tab-context',
    panelId: 'agent-panel-context'
  },
  { id: 'harness', label: 'Harness', tabId: 'agent-tab-harness', panelId: 'agent-panel-harness' },
  {
    id: 'checkpoints',
    label: 'Checkpoints',
    tabId: 'agent-tab-checkpoints',
    panelId: 'agent-panel-checkpoints'
  },
  {
    id: 'prompt-caching',
    label: 'Prompt caching',
    tabId: 'agent-tab-cache',
    panelId: 'agent-panel-cache'
  },
  { id: 'reports', label: 'Reports', tabId: 'agent-tab-reports', panelId: 'agent-panel-reports' },
  {
    id: 'scheduled-runs',
    label: 'Scheduled runs',
    tabId: 'agent-tab-scheduled',
    panelId: 'agent-panel-scheduled'
  }
];

function AgentBehaviorSectionPanel({ section }: { section: AgentBehaviorSectionId }) {
  switch (section) {
    case 'memory':
      return <MemoryPanel />;
    case 'vector':
      return <VectorMemoryPanel />;
    case 'lsp':
      return <EditorLspPanel />;
    case 'inline-completion':
      return <InlineCompletionPanel />;
    case 'run-limits':
      return <RunLimitsPanel />;
    case 'context':
      return <ContextManagementPanel />;
    case 'harness':
      return <HarnessPanel />;
    case 'checkpoints':
      return <CheckpointsPanel />;
    case 'prompt-caching':
      return <PromptCachingPanel />;
    case 'reports':
      return <ReportsPanel />;
    case 'scheduled-runs':
      return <ScheduledRunsPanel />;
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

/** Agent behavior settings — memory, run limits, context, caching, reports, checkpoints, harness. */
export function AgentBehaviorPanel() {
  const [section, setSection] = useState<AgentBehaviorSectionId>('memory');
  const active = SECTION_ITEMS.find((i) => i.id === section) ?? SECTION_ITEMS[0]!;

  return (
    <div className="flex min-h-0 flex-1 gap-6">
      <LeftSubnav
        ariaLabel="Agent behavior sections"
        items={SECTION_ITEMS}
        value={section}
        onChange={setSection}
        className="w-44 shrink-0"
      />
      <div
        id={active.panelId}
        role="tabpanel"
        aria-labelledby={active.tabId}
        className="min-w-0 flex-1"
      >
        <ShellStack>
          <AgentBehaviorSectionPanel section={section} />
        </ShellStack>
      </div>
    </div>
  );
}
