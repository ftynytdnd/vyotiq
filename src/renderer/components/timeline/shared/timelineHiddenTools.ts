/**
 * Tools that settle in the event log but must not render as activity-lane rows.
 * `finish` delivers its summary via assistant-text; `ask_user` uses dedicated rows.
 */

import type { ToolName } from '@shared/types/tool.js';

const HIDDEN: ReadonlySet<ToolName> = new Set(['finish', 'ask_user', 'heartbeat', 'continue']);

export function isTimelineHiddenTool(name: ToolName | string | undefined): boolean {
  return typeof name === 'string' && (HIDDEN as ReadonlySet<string>).has(name);
}
