/**
 * Agent behavior settings sub-section ids (renderer + persistence).
 */

export type AgentBehaviorSectionId =
  | 'memory'
  | 'vector'
  | 'lsp'
  | 'inline-completion'
  | 'run-limits'
  | 'context'
  | 'harness'
  | 'skills'
  | 'checkpoints'
  | 'prompt-caching'
  | 'reports'
  | 'scheduled-runs'
  | 'capture';

export const AGENT_BEHAVIOR_SECTION_IDS: AgentBehaviorSectionId[] = [
  'memory',
  'vector',
  'lsp',
  'inline-completion',
  'run-limits',
  'context',
  'harness',
  'skills',
  'checkpoints',
  'prompt-caching',
  'reports',
  'scheduled-runs',
  'capture'
];

function isAgentBehaviorSectionId(value: string | undefined): value is AgentBehaviorSectionId {
  return value !== undefined && AGENT_BEHAVIOR_SECTION_IDS.includes(value as AgentBehaviorSectionId);
}

export function resolveAgentBehaviorSectionId(
  persisted: string | undefined,
  fallback: AgentBehaviorSectionId = 'memory'
): AgentBehaviorSectionId {
  if (isAgentBehaviorSectionId(persisted)) return persisted;
  return fallback;
}

/** Human-readable labels for agent behavior subsections (nav, panel titles, breadcrumbs). */
export const AGENT_BEHAVIOR_SECTION_LABELS: Record<AgentBehaviorSectionId, string> = {
  memory: 'Memory',
  vector: 'Vector memory',
  lsp: 'Editor LSP',
  'inline-completion': 'Inline completion',
  'run-limits': 'Run limits',
  context: 'Context management',
  harness: 'Harness',
  skills: 'Skills',
  checkpoints: 'Checkpoints',
  'prompt-caching': 'Prompt caching',
  reports: 'Reports',
  'scheduled-runs': 'Scheduled runs',
  capture: 'Screen capture'
};
