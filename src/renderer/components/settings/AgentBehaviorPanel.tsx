/**

 * Settings → Agent behavior — section sub-navigation + single active panel.

 */



import { useCallback, useState } from 'react';

import { MemoryPanel } from './MemoryPanel.js';

import { VectorMemoryPanel } from './VectorMemoryPanel.js';

import { EditorLspPanel } from './EditorLspPanel.js';

import { PromptCachingPanel } from './PromptCachingPanel.js';

import { ReportsPanel } from './ReportsPanel.js';

import { RunLimitsPanel } from './RunLimitsPanel.js';

import { ContextManagementPanel } from './ContextManagementPanel.js';

import { CheckpointsPanel } from './CheckpointsPanel.js';

import { HarnessPanel } from './HarnessPanel.js';
import { SkillsPanel } from './SkillsPanel.js';

import { InlineCompletionPanel } from './InlineCompletionPanel.js';

import { CapturePanel } from './CapturePanel.js';

import { ScheduledRunsPanel } from './ScheduledRunsPanel.js';

import { LeftSubnav, type LeftSubnavItem } from '../ui/LeftSubnav.js';

import { ShellStack } from '../ui/ShellSection.js';

import {

  AGENT_BEHAVIOR_SECTION_IDS,

  AGENT_BEHAVIOR_SECTION_LABELS,

  resolveAgentBehaviorSectionId,

  type AgentBehaviorSectionId

} from '@shared/settings/agentBehaviorSection.js';

import { useSettingsStore } from '../../store/useSettingsStore.js';

import { useAppViewStore } from '../../store/useAppViewStore.js';

import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';



export type { AgentBehaviorSectionId };



const SECTION_TAB_IDS: Record<AgentBehaviorSectionId, { tabId: string; panelId: string }> = {

  memory: { tabId: 'agent-tab-memory', panelId: 'agent-panel-memory' },

  vector: { tabId: 'agent-tab-vector', panelId: 'agent-panel-vector' },

  lsp: { tabId: 'agent-tab-lsp', panelId: 'agent-panel-lsp' },

  'inline-completion': { tabId: 'agent-tab-inline', panelId: 'agent-panel-inline' },

  'run-limits': { tabId: 'agent-tab-limits', panelId: 'agent-panel-limits' },

  context: { tabId: 'agent-tab-context', panelId: 'agent-panel-context' },

  harness: { tabId: 'agent-tab-harness', panelId: 'agent-panel-harness' },

  skills: { tabId: 'agent-tab-skills', panelId: 'agent-panel-skills' },

  checkpoints: { tabId: 'agent-tab-checkpoints', panelId: 'agent-panel-checkpoints' },

  'prompt-caching': { tabId: 'agent-tab-cache', panelId: 'agent-panel-cache' },

  reports: { tabId: 'agent-tab-reports', panelId: 'agent-panel-reports' },

  'scheduled-runs': { tabId: 'agent-tab-scheduled', panelId: 'agent-panel-scheduled' },

  capture: { tabId: 'agent-tab-capture', panelId: 'agent-panel-capture' }

};



const SECTION_ITEMS: LeftSubnavItem<AgentBehaviorSectionId>[] = AGENT_BEHAVIOR_SECTION_IDS.map(

  (id) => ({

    id,

    label: AGENT_BEHAVIOR_SECTION_LABELS[id],

    ...SECTION_TAB_IDS[id]

  })

);



function resolveInitialAgentBehaviorSection(): AgentBehaviorSectionId {

  const pending = useAppViewStore.getState().consumePendingAgentBehaviorSection();

  if (pending) return pending;

  return resolveAgentBehaviorSectionId(

    useSettingsStore.getState().settings.ui?.lastAgentBehaviorSection,

    'memory'

  );

}



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

    case 'skills':

      return <SkillsPanel />;

    case 'checkpoints':

      return <CheckpointsPanel />;

    case 'prompt-caching':

      return <PromptCachingPanel />;

    case 'reports':

      return <ReportsPanel />;

    case 'scheduled-runs':

      return <ScheduledRunsPanel />;

    case 'capture':

      return <CapturePanel />;

    default: {

      const _exhaustive: never = section;

      return _exhaustive;

    }

  }

}



/** Agent behavior settings — memory, run limits, context, caching, reports, checkpoints, harness. */

export function AgentBehaviorPanel() {

  const [section, setSection] = useState<AgentBehaviorSectionId>(resolveInitialAgentBehaviorSection);

  const active = SECTION_ITEMS.find((i) => i.id === section) ?? SECTION_ITEMS[0]!;



  const onSectionChange = useCallback((next: AgentBehaviorSectionId) => {

    setSection(next);

    const prev = useSettingsStore.getState().settings.ui?.lastAgentBehaviorSection;

    if (prev === next) return;

    void persistSettingsPatch({ ui: { lastAgentBehaviorSection: next } });

  }, []);



  return (

    <div className="flex min-h-0 flex-1 gap-6">

      <LeftSubnav

        ariaLabel="Agent behavior sections"

        items={SECTION_ITEMS}

        value={section}

        onChange={onSectionChange}

        className="w-44 shrink-0"

      />

      <div

        id={active.panelId}

        role="tabpanel"

        aria-labelledby={active.tabId}

        className="min-w-0 flex-1"

      >

        <h3 className="vx-settings-subpanel-title">{active.label}</h3>

        <ShellStack>

          <AgentBehaviorSectionPanel section={section} />

        </ShellStack>

      </div>

    </div>

  );

}

