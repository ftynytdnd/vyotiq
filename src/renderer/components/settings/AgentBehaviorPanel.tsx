import { MemoryPanel } from './MemoryPanel.js';
import { PromptCachingPanel } from './PromptCachingPanel.js';
import { ReportsPanel } from './ReportsPanel.js';
import { RunLimitsPanel } from './RunLimitsPanel.js';
import { ContextManagementPanel } from './ContextManagementPanel.js';
import { CheckpointsPanel } from './CheckpointsPanel.js';
import { HarnessPanel } from './HarnessPanel.js';
import { InlineCompletionPanel } from './InlineCompletionPanel.js';

/** Agent behavior settings — memory, run limits, context, caching, reports, checkpoints, harness. */
export function AgentBehaviorPanel() {
  return (
    <>
      <MemoryPanel />
      <InlineCompletionPanel />
      <RunLimitsPanel />
      <ContextManagementPanel />
      <HarnessPanel />
      <CheckpointsPanel />
      <PromptCachingPanel />
      <ReportsPanel />
    </>
  );
}
