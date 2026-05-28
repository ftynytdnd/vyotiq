/**
 * Shared eligibility rules for renderer-initiated tool re-runs.
 * Kept in `@shared` so main-process IPC and renderer UI stay aligned.
 */

import type { RegisteredToolName, ToolCall } from '@shared/types/tool.js';

const RERUN_ALLOWED_TOOLS = new Set<RegisteredToolName>([
  'read',
  'ls',
  'search',
  'memory'
]);

/** Read-only memory actions that are safe to re-run. */
const MEMORY_RERUN_ACTIONS = new Set(['list', 'read']);

export function isRerunnableToolName(name: string): name is RegisteredToolName {
  return RERUN_ALLOWED_TOOLS.has(name as RegisteredToolName);
}

export function isRerunnableToolCall(
  call: Pick<ToolCall, 'name' | 'args'>
): call is Pick<ToolCall, 'id' | 'args'> & { name: RegisteredToolName } {
  if (!isRerunnableToolName(call.name)) return false;
  if (call.name === 'memory') {
    const action = call.args?.['action'];
    return typeof action === 'string' && MEMORY_RERUN_ACTIONS.has(action);
  }
  return true;
}

export function isRerunnableToolInput(
  toolName: RegisteredToolName,
  args: Record<string, unknown>
): boolean {
  if (!RERUN_ALLOWED_TOOLS.has(toolName)) return false;
  if (toolName === 'memory') {
    const action = args?.['action'];
    return typeof action === 'string' && MEMORY_RERUN_ACTIONS.has(action);
  }
  return true;
}
