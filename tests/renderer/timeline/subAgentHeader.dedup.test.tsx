/**
 * `SubAgentHeader` de-duplication regression. Plan §B + audit fix A4.
 *
 * Single-source-of-truth contract (post-audit-A4):
 *   - The outer collapsed `SubAgentTrace` row owns the SOLE rendering
 *     of the worker's task — a truncated quoted preview that doubles
 *     as the section heading once the row expands. Audit fix A4
 *     removed the prior `task — <full>` line from `SubAgentHeader`
 *     because it duplicated the collapsed-row task on every expanded
 *     sub-agent.
 *   - The header (this file under test) owns the sub-agent id,
 *     status pill, optional usage chip, file chips, granted-tools
 *     chips, live-status phase, and any failure message — but NEVER
 *     the task line and NEVER its own `StatusIcon` (the latter
 *     produced the triple-status-glyph noise visible in earlier
 *     screenshots).
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SubAgentHeader } from '@renderer/components/timeline/subagent/SubAgentHeader';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function snap(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'T1',
    task: 'Search for every TODO comment in core/',
    files: [],
    missingFiles: [],
    tools: [],
    status: 'running',
    startedAt: 0,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    ...overrides
  };
}

describe('SubAgentHeader de-duplication', () => {
  it('renders the sub-agent id and does NOT render the task (audit fix A4)', () => {
    // Post-A4: the task is rendered exclusively by the outer collapsed
    // `SubAgentTrace` row. The header MUST NOT echo it — that was the
    // duplication source the audit removed.
    const { container } = render(<SubAgentHeader snap={snap()} />);
    expect(container.textContent).toContain('Sub-agent T1');
    // The full task body must NOT appear anywhere in the header.
    expect(container.textContent).not.toContain(
      'Search for every TODO comment in core/'
    );
    // The literal `task —` prefix must also be gone.
    expect(container.textContent).not.toContain('task —');
  });

  it('renders the status pill (Running for in-flight)', () => {
    const { container } = render(<SubAgentHeader snap={snap({ status: 'running' })} />);
    const pill = container.querySelector('span.capitalize');
    expect(pill?.textContent).toBe('running');
  });

  it('does NOT render the inner StatusIcon (no spinner / check / x svg in header)', () => {
    // The Bot icon is still rendered as a leading glyph; the regression
    // is the trailing StatusIcon — Loader2 / CheckCircle2 / XCircle.
    // We assert NONE of those three lucide icons are present in the
    // header by inspecting svg classes.
    const { container } = render(<SubAgentHeader snap={snap({ status: 'running' })} />);
    const svgs = Array.from(container.querySelectorAll('svg'));
    const classes = svgs.map((s) => s.getAttribute('class') ?? '');
    // Spinner, success check, failure cross all use the `text-accent`,
    // `text-success`, `text-danger` tokens via the StatusIcon helper.
    // None should appear on this header now.
    const offendingTokens = ['animate-spin', 'text-success', 'text-danger', 'text-accent'];
    for (const cls of classes) {
      for (const tok of offendingTokens) {
        expect(cls).not.toContain(tok);
      }
    }
  });

  it('renders cleanly when the snapshot has no task yet (audit fix A4)', () => {
    // Post-A4: the header no longer carries a task line at all, so
    // there is nothing to shimmer when the task is still arriving.
    // The pending cue lives on the OUTER collapsed `SubAgentTrace`
    // row (typography only — chevron + muted label while live). The header
    // simply renders the id + status pill without crashing.
    const { container } = render(<SubAgentHeader snap={snap({ task: '', status: 'pending' })} />);
    expect(container.textContent).not.toContain('(task pending)');
    expect(container.textContent).not.toContain('task —');
    expect(container.textContent).toContain('Sub-agent T1');
    // The status pill should still be present and reflect the live state.
    const pill = container.querySelector('span.capitalize');
    expect(pill?.textContent).toBe('pending');
  });
});
