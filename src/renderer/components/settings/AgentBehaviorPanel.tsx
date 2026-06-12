import { MemoryPanel } from './MemoryPanel.js';
import { PromptCachingPanel } from './PromptCachingPanel.js';
import { ReportsPanel } from './ReportsPanel.js';
import { RunLimitsPanel } from './RunLimitsPanel.js';
import { ContextManagementPanel } from './ContextManagementPanel.js';

/** Agent behavior settings — memory, run limits, context, caching, reports. */
export function AgentBehaviorPanel() {
  return (
    <>
      <MemoryPanel />
      <RunLimitsPanel />
      <ContextManagementPanel />
      <PromptCachingPanel />
      <ReportsPanel />
    </>
  );
}
