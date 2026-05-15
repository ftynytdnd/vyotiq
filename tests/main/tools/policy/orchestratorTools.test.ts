/**
 * Pins the orchestrator's direct toolset.
 *
 * The Stanford "Orchestration Over Architecture" subtraction pass
 * prunes `read` (and never had `bash` / `edit` / `search`) from this
 * surface. The orchestrator's job is decomposition, delegation, and
 * verification — NOT reading file bodies into its own context. If a
 * future refactor accidentally re-adds any heavy tool here, the model
 * will silently revert to the failure mode we recorded in production
 * (65 direct `read` calls, zero `<delegate>` directives). This test
 * is the regression guard.
 */

import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_TOOLS } from '@main/tools/policy/orchestratorTools';

describe('ORCHESTRATOR_TOOLS', () => {
  it('contains exactly ls, memory, recall — and nothing else', () => {
    // Order is part of the contract: the harnessLoader uses this list
    // to decide which `### Tool:` briefs go into the "Direct Tools"
    // section vs the "Delegated Tools" section.
    expect([...ORCHESTRATOR_TOOLS]).toEqual(['ls', 'memory', 'recall']);
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
