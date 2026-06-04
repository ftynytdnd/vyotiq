/**
 * Pins the orchestrator's direct toolset.
 *
 * The forced-action loop makes `delegate` / `finish` / `ask_user`
 * first-class callable tools (no more `<delegate>` XML directive), so
 * they join the recon tools (`ls` / `memory` / `recall`) in the
 * orchestrator's schema. The orchestrator's job is still decomposition,
 * delegation, and verification — NOT reading file bodies into its own
 * context — so `read` / `bash` / `edit` / `search` / `report` stay
 * delegate-only. If a future refactor accidentally re-adds any heavy
 * tool here, the model will silently revert to the failure mode we
 * recorded in production (65 direct `read` calls, zero delegations).
 * This test is the regression guard.
 */

import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_TOOLS } from '@main/tools/policy/orchestratorTools';

describe('ORCHESTRATOR_TOOLS', () => {
  it('contains exactly ls, memory, recall, delegate, finish, ask_user — and nothing else', () => {
    // Order is part of the contract: the harnessLoader uses this list
    // to split the `### Tool:` briefs into the orchestrator's own
    // callable tools vs the delegate-only sub-agent toolset.
    expect([...ORCHESTRATOR_TOOLS]).toEqual([
      'ls',
      'memory',
      'recall',
      'delegate',
      'finish',
      'ask_user'
    ]);
  });

  it('includes the forced-action loop tools (delegate, finish, ask_user)', () => {
    // These drive, end, and pause the closed loop respectively. They
    // are dispatched specially by the run loop (intercepted by name)
    // but MUST be present in the orchestrator's function-calling
    // schema so the model can emit them under `tool_choice:'required'`.
    for (const t of ['delegate', 'finish', 'ask_user'] as const) {
      expect(ORCHESTRATOR_TOOLS).toContain(t);
    }
  });

  it('does NOT contain `read` (file reading must go through delegation)', () => {
    expect(ORCHESTRATOR_TOOLS).not.toContain('read');
  });

  it('does NOT contain `bash`, `edit`, or `search`', () => {
    // These have always been delegate-only; this assertion is here so
    // a future "convenience" PR can't quietly add one.
    for (const t of ['bash', 'edit', 'search'] as const) {
      expect(ORCHESTRATOR_TOOLS).not.toContain(t);
    }
  });

  it('does NOT contain `report` (artifact writer is delegate-only)', () => {
    // `report` lives behind `<delegate tools="report" />` per the
    // harness contract. The orchestrator must NEVER author HTML
    // directly — heavy authoring is delegation work. A future "let
    // the orchestrator skip the delegate hop for small reports" PR
    // would defeat the parallel-decomposition pattern this list
    // enforces. Keep it excluded.
    expect(ORCHESTRATOR_TOOLS).not.toContain('report');
  });
});
