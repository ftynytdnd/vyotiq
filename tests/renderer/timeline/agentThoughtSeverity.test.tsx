/**
 * `AgentThoughtRow` severity regression. Plan §H.
 *
 * Asserts:
 *   - `info` (default) renders muted italic text.
 *   - `warn` renders a warning-toned line with the AlertTriangle glyph
 *     so retry warnings don't blend in with the silent thinking line.
 *   - `deriveRows` carries the severity field through unchanged.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AgentThoughtRow } from '@renderer/components/timeline/rows/AgentThoughtRow';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import type { TimelineEvent } from '@shared/types/chat';

describe('AgentThoughtRow severity', () => {
  it('renders default (info) as muted italic', () => {
    const { container } = render(<AgentThoughtRow content="thinking quietly" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('thinking quietly');
    expect(span?.className).toMatch(/italic/);
    expect(span?.className).toMatch(/text-text-muted/);
    // No alert glyph in info mode.
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders warn with the warning palette + alert icon', () => {
    const { container } = render(
      <AgentThoughtRow content="LLM call failed (1/3): timeout. Retrying." severity="warn" />
    );
    const text = container.querySelector('span');
    expect(text?.textContent).toContain('LLM call failed');
    expect(text?.className).toMatch(/text-warning/);
    // The AlertTriangle icon must be present.
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('deriveRows agent-thought severity passthrough', () => {
  it('forwards severity from event to row descriptor', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: 0, content: 'hi' },
      {
        kind: 'agent-thought',
        id: 't1',
        ts: 1,
        content: 'retrying',
        severity: 'warn'
      }
    ];
    const rows = deriveRows(events);
    const thought = rows.find((r) => r.kind === 'agent-thought');
    expect(thought).toBeDefined();
    if (thought && thought.kind === 'agent-thought') {
      expect(thought.severity).toBe('warn');
    }
  });

  it('omits severity when the event has none', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'u1', ts: 0, content: 'hi' },
      { kind: 'agent-thought', id: 't1', ts: 1, content: 'thinking…' }
    ];
    const rows = deriveRows(events);
    const thought = rows.find((r) => r.kind === 'agent-thought');
    if (thought && thought.kind === 'agent-thought') {
      expect(thought.severity).toBeUndefined();
    }
  });
});
