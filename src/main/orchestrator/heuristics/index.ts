/**
 * Heuristics module — pure predicates the orchestrator loop consults to
 * decide whether to terminate, nudge, or escalate.
 */

export {
  classifyPlanningWithoutAction
} from './isPlanningWithoutAction.js';
export type { PlanningOutcome } from './isPlanningWithoutAction.js';
