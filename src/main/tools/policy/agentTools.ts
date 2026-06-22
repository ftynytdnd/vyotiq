/**
 * Single-agent tool policy.
 *
 * Agent V is one dynamic agent: plan, act with tools directly, then
 * `finish` or `ask_user`. There is no delegation surface and no
 * separate worker allowlist.
 */

import type { ToolName } from '@shared/types/tool.js';

export const AGENT_TOOLS: readonly ToolName[] = [
  'bash',
  'ls',
  'read',
  'edit',
  'delete',
  'search',
  'sg',
  'memory',
  'recall',
  'context',
  'todos',
  'report',
  'capture',
  'heartbeat',
  'continue',
  'finish',
  'ask_user'
] as const;
