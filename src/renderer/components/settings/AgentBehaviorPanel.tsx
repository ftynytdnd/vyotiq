import { MemoryPanel } from './MemoryPanel.js';
import { PromptCachingPanel } from './PromptCachingPanel.js';
import { ReportsPanel } from './ReportsPanel.js';

/** Agent behavior settings — memory, prompt caching, HTML report deliverables. */
export function AgentBehaviorPanel() {
  return (
    <>
      <MemoryPanel />
      <PromptCachingPanel />
      <ReportsPanel />
    </>
  );
}
