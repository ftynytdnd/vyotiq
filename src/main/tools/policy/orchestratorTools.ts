/**
 * Orchestrator tool policy.
 *
 * Agent V is strictly an orchestration pattern, not a reasoning pattern
 * (see `project.md` and `00-orchestrator-core.md`). Its sole responsibility
 * is decomposition, delegation, and verification. To enforce that
 * physically — not just via the harness — the orchestrator's direct tool
 * catalogue is the minimum surface needed to *decide what to delegate*
 * plus the action tools that drive the closed forced-action loop:
 *
 *   - `ls`     — workspace structure reconnaissance (no file contents).
 *   - `memory` — persistent meta-rules / workspace notes.
 *   - `recall` — read-only lookup against OTHER conversations the user
 *     has had with the agent in this workspace. Listed here, NOT in
 *     `SUBAGENT_FULL_TOOLS`, so the isolation invariant for ephemeral
 *     workers stays intact.
 *   - `delegate` — spawns a real ephemeral sub-agent for one micro-task;
 *     multiple parallel calls in one turn fan out concurrently. This is
 *     now a first-class callable tool, NOT a `<delegate ... />` XML
 *     directive.
 *   - `finish`   — terminal tool that ends the run and delivers the final
 *     user-facing answer (`summary`).
 *   - `ask_user` — pause tool that surfaces a clarifying question and
 *     ends the run cleanly; the user's reply resumes work.
 *
 * `delegate` / `finish` / `ask_user` are dispatched specially by the run
 * loop (intercepted by name) rather than executed through the generic
 * tool executor. They are deliberately kept OUT of every `SUBAGENT_*`
 * allowlist so workers cannot recurse, finish-as-orchestrator, or pause
 * the run.
 *
 * `read`, `bash`, `edit`, and `search` are deliberately ABSENT. The
 * orchestrator must emit `delegate` to load file contents into an
 * ephemeral worker; reading a file directly into the orchestrator's own
 * context defeats the parallel-decomposition pattern (Stanford
 * "Orchestration Over Architecture" §Subtraction Principle).
 *
 * Why `read` was removed (audit pass): in production the model
 * consistently chose to satisfy "analyze N files" via N direct `read`
 * calls instead of N parallel `delegate` calls — function-call salience
 * won over harness prose. Pruning the tool aligns the surface with the
 * contract.
 *
 * The MODEL-FACING version of this rationale lives in
 * `src/main/harness/00-orchestrator-core.md` §1 ("You are an
 * orchestrator, NOT a worker"). Keep the two in sync when this list
 * changes — the harness worked example at the top of that file
 * enumerates the exact tools the model sees.
 */

import type { ToolName } from '@shared/types/tool.js';

export const ORCHESTRATOR_TOOLS: readonly ToolName[] = [
  'ls',
  'memory',
  'recall',
  'delegate',
  'finish',
  'ask_user'
] as const;
