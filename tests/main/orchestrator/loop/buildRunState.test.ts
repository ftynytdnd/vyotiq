/**
 * Pins the `<run_state>` envelope shape. This is the model-facing
 * surface that replaces several reactive heuristics in the audit pass —
 * if any field name or order changes silently, the harness prose that
 * references it (e.g. "Use `<run_state>` to see what you've already
 * done") would silently lose meaning.
 *
 * Subtraction-pass note: the `spin_nudges:` line was removed alongside
 * the host-side spin nudge / halt path. The `spin_signature_hot:` line
 * remains as pure observability — the model uses it to pivot before
 * the per-run tool-result cache starts banner-prepending identical
 * calls.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRunStateXml,
  createRunStateAccumulator,
  snapshotRunState
} from '@main/orchestrator/loop/buildRunState';
import { MAX_NUDGES_PER_RUN } from '@main/orchestrator/loop/handleNoToolNoDelegate';
import { MAX_TOTAL_ITERATIONS } from '@shared/constants';
import {
  createSpinSignatureBuffer,
  pushToolRound,
  toolCallSignature
} from '@main/orchestrator/loop/toolSpinSignature';

describe('buildRunStateXml', () => {
  it('renders the six required fields in a stable order', () => {
    const acc = createRunStateAccumulator();
    acc.iteration = 4;
    acc.directToolRoundsTotal = 3;
    acc.delegateRoundsTotal = 1;
    acc.lastAction = 'delegate';
    acc.spinSignatureHot = null;

    const counters = { consecutiveBadRounds: 0, perTaskBadStreak: new Map<string, number>() };
    const nudges = { used: 0 };
    const spin = createSpinSignatureBuffer();

    const xml = buildRunStateXml(
      snapshotRunState(acc, counters, nudges, spin, /*consecutiveBadToolRounds=*/ 0)
    );

    // Outer envelope.
    expect(xml.startsWith('<run_state>')).toBe(true);
    expect(xml.endsWith('</run_state>')).toBe(true);

    // Field order must match the harness prose so the model can
    // pattern-match it reliably.
    const lines = xml
      .replace(/^<run_state>\n/, '')
      .replace(/\n<\/run_state>$/, '')
      .split('\n');
    expect(lines[0]).toBe(`iteration: 4 of ${MAX_TOTAL_ITERATIONS}`);
    expect(lines[1]).toBe('direct_tool_rounds: 3 (consecutive_failed_tools: 0)');
    expect(lines[2]).toBe('delegate_rounds: 1 (consecutive_bad_delegation: 0)');
    expect(lines[3]).toBe(`planning_nudges: 0 of ${MAX_NUDGES_PER_RUN} used`);
    expect(lines[4]).toBe('last_action: delegate');
    expect(lines[5]).toBe('spin_signature_hot: (none)');
  });

  it('does NOT include a spin_nudges counter line (subtraction-pass)', () => {
    // Regression: the spin nudge / halt path was removed so the
    // counter line MUST be absent. A future re-introduction would
    // also need to re-introduce the nudge budget — this test pins
    // both halves of that decision.
    const acc = createRunStateAccumulator();
    const xml = buildRunStateXml(
      snapshotRunState(
        acc,
        { consecutiveBadRounds: 0, perTaskBadStreak: new Map() },
        { used: 0 },
        createSpinSignatureBuffer(),
        0
      )
    );
    expect(xml).not.toContain('spin_nudges:');
    expect(xml).not.toContain('MAX_ORCHESTRATOR_SPIN_NUDGES');
  });

  it('reflects live counters and nudge usage', () => {
    const acc = createRunStateAccumulator();
    acc.iteration = 2;
    acc.lastAction = 'direct-tool';
    const counters = { consecutiveBadRounds: 1, perTaskBadStreak: new Map<string, number>() };
    const nudges = { used: 1 };
    const spin = createSpinSignatureBuffer();

    const xml = buildRunStateXml(
      snapshotRunState(acc, counters, nudges, spin, /*consecutiveBadToolRounds=*/ 2)
    );

    expect(xml).toContain('direct_tool_rounds: 0 (consecutive_failed_tools: 2)');
    expect(xml).toContain('delegate_rounds: 0 (consecutive_bad_delegation: 1)');
    expect(xml).toContain(`planning_nudges: 1 of ${MAX_NUDGES_PER_RUN} used`);
    expect(xml).toContain('last_action: direct-tool');
  });

  it('surfaces the hot tool-call signature when one is filling the buffer', () => {
    const acc = createRunStateAccumulator();
    acc.iteration = 5;
    const counters = { consecutiveBadRounds: 0, perTaskBadStreak: new Map<string, number>() };
    const nudges = { used: 0 };
    const spin = createSpinSignatureBuffer();
    const sig = toolCallSignature('read', { path: 'README.md' });
    pushToolRound(spin, [sig]);
    pushToolRound(spin, [sig]);
    acc.spinSignatureHot = sig; // mirrors what runLoop sets each iter

    const xml = buildRunStateXml(
      snapshotRunState(acc, counters, nudges, spin, /*consecutiveBadToolRounds=*/ 0)
    );
    expect(xml).toContain(`spin_signature_hot: ${sig}`);
  });

  it('renders "(none)" when no signature is hot', () => {
    const acc = createRunStateAccumulator();
    acc.spinSignatureHot = null;
    const xml = buildRunStateXml(
      snapshotRunState(
        acc,
        { consecutiveBadRounds: 0, perTaskBadStreak: new Map() },
        { used: 0 },
        createSpinSignatureBuffer(),
        0
      )
    );
    expect(xml).toContain('spin_signature_hot: (none)');
  });

  /**
   * T1-1: the harness illustrative `<run_state>` block lists
   * `failing_tasks` as a stable field. The renderer ALWAYS includes
   * the line — `(none)` when the per-task strike map is empty, and a
   * structured multi-line list otherwise. Pins both branches.
   */
  it('always emits a failing_tasks: line (T1-1) — `(none)` when nothing is hot', () => {
    const acc = createRunStateAccumulator();
    const xml = buildRunStateXml(
      snapshotRunState(
        acc,
        { consecutiveBadRounds: 0, perTaskBadStreak: new Map() },
        { used: 0 },
        createSpinSignatureBuffer(),
        0
      )
    );
    expect(xml).toContain('failing_tasks: (none)');
  });

  it('lists each failing task with its streak when one crosses the soft threshold (T1-1)', () => {
    const acc = createRunStateAccumulator();
    const counters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map<string, number>([
        ['edit src/foo.ts|src/foo.ts', 2],
        ['edit src/bar.ts|src/bar.ts', 3]
      ])
    };
    const xml = buildRunStateXml(
      snapshotRunState(
        acc,
        counters,
        { used: 0 },
        createSpinSignatureBuffer(),
        0
      )
    );
    // Header line on its own.
    expect(xml).toContain('failing_tasks:');
    // Highest streak first (sort order in the renderer).
    const failingIdx = xml.indexOf('failing_tasks:');
    const tail = xml.slice(failingIdx);
    expect(tail).toMatch(/streak 3:.*edit src\/bar\.ts/);
    expect(tail).toMatch(/streak 2:.*edit src\/foo\.ts/);
    // The "(none)" sentinel must NOT appear when a list is rendered.
    expect(tail).not.toContain('(none)');
  });

  /**
   * T1-1: `child_redelegations:` is rendered ONLY when non-zero so the
   * steady-state path stays silent. Pin both branches.
   */
  it('omits child_redelegations when the count is zero', () => {
    const acc = createRunStateAccumulator();
    acc.childRedelegationsTotal = 0;
    const xml = buildRunStateXml(
      snapshotRunState(
        acc,
        { consecutiveBadRounds: 0, perTaskBadStreak: new Map() },
        { used: 0 },
        createSpinSignatureBuffer(),
        0
      )
    );
    expect(xml).not.toContain('child_redelegations:');
  });

  it('renders child_redelegations when the model has tried to call delegate as a tool', () => {
    const acc = createRunStateAccumulator();
    acc.childRedelegationsTotal = 2;
    const xml = buildRunStateXml(
      snapshotRunState(
        acc,
        { consecutiveBadRounds: 0, perTaskBadStreak: new Map() },
        { used: 0 },
        createSpinSignatureBuffer(),
        0
      )
    );
    expect(xml).toContain('child_redelegations: 2');
    // The line includes a one-line corrective hint so the model
    // recognises the channel mistake without further prompting.
    expect(xml).toContain('XML directive');
  });
});

describe('createRunStateAccumulator', () => {
  it('starts in a clean "none" state', () => {
    const acc = createRunStateAccumulator();
    expect(acc.iteration).toBe(0);
    expect(acc.directToolRoundsTotal).toBe(0);
    expect(acc.delegateRoundsTotal).toBe(0);
    expect(acc.lastAction).toBe('none');
    expect(acc.spinSignatureHot).toBeNull();
  });
});
