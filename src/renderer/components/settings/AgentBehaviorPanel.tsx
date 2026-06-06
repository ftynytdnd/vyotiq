import { MemoryPanel } from './MemoryPanel.js';
import { ReportsPanel } from './ReportsPanel.js';

/** Agent behavior settings — memory + HTML report deliverables. */
export function AgentBehaviorPanel() {
  return (
    <>
      <MemoryPanel />
      <ReportsPanel />
    </>
  );
}
