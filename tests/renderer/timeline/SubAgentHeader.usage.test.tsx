/**
 * `SubAgentHeader` usage-pill tests. Covers:
 *   - the pill is absent when the snapshot has no usage aggregate
 *   - the pill renders current by default and cycles through
 *     peak → cumulative → current on click
 *   - the tooltip always lists all three values
 */

import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SubAgentHeader } from '@renderer/components/timeline/subagent/SubAgentHeader';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function snap(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'sa-1',
    task: 'look at things',
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

describe('SubAgentHeader usage pill', () => {
  it('is not rendered when no usage data exists', () => {
    const { container } = render(<SubAgentHeader snap={snap()} />);
    expect(container.querySelector('button[title*="Current"]')).toBeNull();
  });

  it('shows the current value by default with no redundant view-name suffix', () => {
    const withUsage = snap({
      usage: {
        latest: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        peak: { promptTokens: 150, completionTokens: 40, totalTokens: 190 },
        cumulative: { promptTokens: 300, completionTokens: 50, totalTokens: 350 },
        samples: 2
      }
    });
    const { container } = render(<SubAgentHeader snap={withUsage} />);
    // The default `current` view drops its redundant label suffix so
    // the pill reads as just the count. The tooltip still names the
    // active view + lists all three values for discoverability.
    const btn = container.querySelector('button[title*="Current"]') as HTMLElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain('120');
    expect(btn!.textContent).not.toMatch(/current/i);
    expect(btn!.getAttribute('title')).toContain('showing current');
    expect(btn!.getAttribute('title')).toContain('Peak 150');
    expect(btn!.getAttribute('title')).toContain('Cumulative 350');
  });

  it('cycles current → peak → cumulative → current and shows the label only off-default', () => {
    const withUsage = snap({
      usage: {
        latest: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        peak: { promptTokens: 150, completionTokens: 40, totalTokens: 190 },
        cumulative: { promptTokens: 300, completionTokens: 50, totalTokens: 350 },
        samples: 2
      }
    });
    const { container } = render(<SubAgentHeader snap={withUsage} />);
    const btn = () => container.querySelector('button[title*="Current"]') as HTMLElement;
    // Default: no view-name label, just the count.
    expect(btn().textContent).toContain('120');
    expect(btn().textContent).not.toMatch(/current|peak|cumulative/i);

    fireEvent.click(btn());
    expect(btn().textContent).toContain('peak');
    expect(btn().textContent).toContain('150');

    fireEvent.click(btn());
    expect(btn().textContent).toContain('cumulative');
    expect(btn().textContent).toContain('350');

    fireEvent.click(btn());
    // Back to the unadorned default.
    expect(btn().textContent).toContain('120');
    expect(btn().textContent).not.toMatch(/current|peak|cumulative/i);
  });
});

describe('SubAgentHeader chip cleanup (post-redesign)', () => {
  it('does NOT render the historical file-chip wall in the status strip', () => {
    // Per the redesign brief ("Remove unnecessary chips and clutter"),
    // file + tool chips moved into the structured Scope subsection
    // inside `SubAgentBriefing` and no longer live on the status
    // strip. The strip carries id + status pill + usage pill ONLY.
    const files = Array.from({ length: 12 }, (_, i) => `src/file-${i + 1}.ts`);
    const { container } = render(<SubAgentHeader snap={snap({ files })} />);
    for (let i = 0; i < 12; i++) {
      expect(container.textContent).not.toContain(`file-${i + 1}.ts`);
    }
    // No `+N more` overflow toggle remains either.
    expect(container.textContent).not.toMatch(/\+\d+ more/);
  });

  it('does NOT render tool chips in the status strip', () => {
    const tools = ['read', 'edit', 'bash', 'search', 'memory', 'recall'];
    const { container } = render(<SubAgentHeader snap={snap({ tools })} />);
    for (const t of tools) {
      // The strip MUST NOT carry tool names; they live on the
      // Scope list inside `SubAgentBriefing`.
      expect(container.textContent).not.toContain(t);
    }
  });
});

describe('SubAgentHeader liveStatus gating', () => {
  it('suppresses the per-worker phase line while pending', () => {
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          status: 'pending',
          liveStatus: { phase: 'connecting', label: 'Connecting to OpenRouter…', ts: 0 }
        })}
      />
    );
    expect(container.textContent).not.toContain('Connecting to OpenRouter');
  });

  it('renders the per-worker phase line while running', () => {
    const { container } = render(
      <SubAgentHeader
        snap={snap({
          status: 'running',
          liveStatus: { phase: 'connecting', label: 'Connecting to OpenRouter…', ts: 0 }
        })}
      />
    );
    expect(container.textContent).toContain('Connecting to OpenRouter');
  });
});
