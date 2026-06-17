/**
 * Per-phase tool allowlists — host hard-blocks tools outside the list.
 */

import type { RegisteredToolName } from '@shared/types/tool.js';
import type { ExecutionPhase } from '@shared/types/phased.js';

const READ_TOOLS: readonly RegisteredToolName[] = [
  'ls',
  'read',
  'search',
  'sg',
  'recall',
  'memory'
];

const READ_WITH_GATE: readonly RegisteredToolName[] = [...READ_TOOLS, 'phase_gate', 'ask_user'];

const PLAN_TOOLS: readonly RegisteredToolName[] = [...READ_WITH_GATE];

const EXECUTE_TOOLS: readonly RegisteredToolName[] = [
  'bash',
  'ls',
  'read',
  'edit',
  'delete',
  'search',
  'sg',
  'memory',
  'recall',
  'report',
  'phase_gate',
  'ask_user'
];

const VERIFY_TOOLS: readonly RegisteredToolName[] = [
  ...READ_TOOLS,
  'bash',
  'phase_gate',
  'ask_user'
];

const DONE_TOOLS: readonly RegisteredToolName[] = [
  'finish',
  'ask_user',
  'phase_gate',
  'ls',
  'read',
  'search',
  'recall'
];

const PHASE_TOOL_ALLOWLIST: Record<ExecutionPhase, readonly RegisteredToolName[]> = {
  intake: [...READ_WITH_GATE],
  understand: READ_WITH_GATE,
  think_frame: READ_WITH_GATE,
  plan: PLAN_TOOLS,
  rethink: READ_WITH_GATE,
  checkpoint: READ_WITH_GATE,
  execute: EXECUTE_TOOLS,
  verify: VERIFY_TOOLS,
  diagnose: READ_WITH_GATE,
  reflect: READ_WITH_GATE,
  done: DONE_TOOLS
};

export function toolsAllowedInPhase(phase: ExecutionPhase): readonly RegisteredToolName[] {
  return PHASE_TOOL_ALLOWLIST[phase];
}

export function isToolAllowedInPhase(phase: ExecutionPhase, toolName: string): boolean {
  return PHASE_TOOL_ALLOWLIST[phase].includes(toolName as RegisteredToolName);
}
