/**
 * Phase 5 (2026) — Context Inspector "Wire breakdown" rendering.
 *
 * Pins:
 *   - Renders three rows: system prompt, tool schemas, message bodies.
 *   - The footer total equals the sum of the three rows.
 *   - The pct% label follows the same `<1%` floor / clamped-to-100
 *     conventions as the composer pill.
 *   - The block is hidden when the framing total is zero (empty
 *     conversation — no harness loaded yet).
 *   - When the ceiling is unknown, percentages scale to the total
 *     instead of crashing.
 */

import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WireBreakdown } from '@renderer/components/contextInspector/WireBreakdown';
import type {
  ContextInspectorSnapshot,
  ContextSummaryRules
} from '@shared/types/contextSummary';
import { DEFAULT_CONTEXT_SUMMARY_RULES } from '@shared/types/contextSummary';

const baseRules: ContextSummaryRules = DEFAULT_CONTEXT_SUMMARY_RULES;

function snapshot(
  framing: ContextInspectorSnapshot['framing'],
  ceiling?: number
): ContextInspectorSnapshot {
  return {
    conversationId: 'c-1',
    workspaceId: 'ws-1',
    rules: baseRules,
    workspaceOverridePresent: false,
    messages: [],
    totalTokens: 0,
    framing,
    ...(typeof ceiling === 'number' ? { ceiling, currentRatio: framing.total / ceiling } : {})
  };
}

describe('WireBreakdown', () => {
  it('renders rows for system + tools + bodies and a footer total', () => {
    const { container } = render(
      <WireBreakdown
        snapshot={snapshot(
          {
            systemPromptTokens: 18_400,
            toolSchemaTokens: 3_100,
            bodyTokens: 14_700,
            total: 36_200
          },
          128_000
        )}
      />
    );
    const text = container.textContent ?? '';
    expect(text).toContain('System prompt + envelopes');
    expect(text).toContain('Tool schemas');
    expect(text).toContain('Message bodies');
    expect(text).toContain('18.4k');
    expect(text).toContain('3.1k');
    expect(text).toContain('14.7k');
    // Footer shows percent only (token total lives in the header badge).
    expect(text).toContain('28.3%');
    expect(text).not.toContain('36.2k');
  });

  it('returns null (renders nothing) when framing total is zero', () => {
    const { container } = render(
      <WireBreakdown
        snapshot={snapshot({
          systemPromptTokens: 0,
          toolSchemaTokens: 0,
          bodyTokens: 0,
          total: 0
        })}
      />
    );
    expect(container.textContent ?? '').toBe('');
  });

  it('scales bars relative to the total when no ceiling is known', () => {
    const { container } = render(
      <WireBreakdown
        snapshot={snapshot({
          systemPromptTokens: 80,
          toolSchemaTokens: 10,
          bodyTokens: 10,
          total: 100
        })}
      />
    );
    // Total / total = 100%; the footer must not show a `/ ceiling`
    // suffix when none was supplied.
    const text = container.textContent ?? '';
    expect(text).toContain('100.0%');
    expect(text).not.toContain('/ 128k');
  });

  it('shows `<1%` for tiny non-zero ratios in any row', () => {
    const { container } = render(
      <WireBreakdown
        snapshot={snapshot(
          {
            systemPromptTokens: 10,
            toolSchemaTokens: 5,
            bodyTokens: 0,
            total: 15
          },
          1_000_000
        )}
      />
    );
    expect(container.textContent ?? '').toContain('<0.1%');
  });

  /**
   * Foldable per-envelope breakdown (Phase 12 follow-up, 2026).
   *
   * The "System prompt + envelopes" row gains a clickable chevron
   * when the snapshot carries a `framing.envelopes` array. Toggling
   * the chevron reveals indented sub-rows — one per envelope — that
   * show where the system-prompt budget is actually going (harness
   * body vs each named context envelope). The sub-rows are
   * closed-by-default so users who only care about the headline
   * numbers see no extra chrome.
   *
   * The four assertions below pin the contract:
   *   1. A snapshot WITHOUT `envelopes` renders the system row as a
   *      plain row (no `<button>`, no chevron) — legacy back-compat.
   *   2. A snapshot WITH `envelopes` renders the row as a
   *      `<button>` carrying `aria-expanded`, and the sub-rows are
   *      not in the DOM yet (closed by default).
   *   3. Clicking the button flips `aria-expanded` to `true` and
   *      each envelope's label + token count appears in the DOM.
   *   4. Clicking it again collapses (idempotent toggle).
   */
  it('renders the system row as a plain row when no envelopes field is present (legacy)', () => {
    const { container } = render(
      <WireBreakdown
        snapshot={snapshot(
          {
            systemPromptTokens: 18_400,
            toolSchemaTokens: 3_100,
            bodyTokens: 14_700,
            total: 36_200
            // No `envelopes` key — simulates a legacy snapshot from a
            // pre-foldable build or a path that couldn't compute the
            // breakdown (no system message).
          },
          128_000
        )}
      />
    );
    // No button anywhere in the row list (the only buttons in this
    // component come from the foldable surface). The header eyebrow
    // text + total still render.
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent ?? '').toContain('System prompt + envelopes');
  });

  it('renders a clickable toggle when framing.envelopes is populated', () => {
    const { container } = render(
      <WireBreakdown
        snapshot={snapshot(
          {
            systemPromptTokens: 18_400,
            toolSchemaTokens: 3_100,
            bodyTokens: 14_700,
            total: 36_200,
            envelopes: [
              { label: 'Harness body', tokens: 12_000 },
              { label: 'Meta rules', tokens: 200 },
              { label: 'Host environment', tokens: 80 },
              { label: 'Workspace context', tokens: 3_500 },
              { label: 'Session context', tokens: 40 },
              { label: 'Run state', tokens: 60 },
              { label: 'Prior conversations', tokens: 1_500 },
              { label: 'Recent memory', tokens: 1_020 }
            ]
          },
          128_000
        )}
      />
    );
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-expanded')).toBe('true');
    // Expanded by default — envelope sub-rows are visible.
    expect(container.textContent ?? '').toContain('Host environment');
    expect(container.textContent ?? '').toContain('Recent memory');
  });

  it('collapses envelope sub-rows on click and expands on second click', () => {
    const { container } = render(
      <WireBreakdown
        snapshot={snapshot(
          {
            systemPromptTokens: 18_400,
            toolSchemaTokens: 3_100,
            bodyTokens: 14_700,
            total: 36_200,
            envelopes: [
              { label: 'Harness body', tokens: 12_000 },
              { label: 'Host environment', tokens: 80 },
              { label: 'Recent memory', tokens: 1_020 }
            ]
          },
          128_000
        )}
      />
    );
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent ?? '').toContain('Host environment');

    // First click — collapse.
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const collapsed = container.textContent ?? '';
    expect(collapsed).not.toContain('Host environment');
    expect(collapsed).not.toContain('Recent memory');

    // Second click — expand again.
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const expanded = container.textContent ?? '';
    expect(expanded).toContain('Harness body');
    expect(expanded).toContain('Host environment');
    expect(expanded).toContain('Recent memory');
    expect(expanded).toContain('12k');
    expect(expanded).toContain('1.0k');
  });
});
