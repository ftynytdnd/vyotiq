/**
 * `TokenUsagePill` tests. Three behavioral surfaces:
 *
 *   1. **No-ceiling action**: when `ceiling` is undefined, the pill
 *      surfaces a single-click `Set ctx` button instead of a useless
 *      raw token count.
 *   2. **Inline editor**: clicking the pill opens an input that
 *      parses `128k` / `1M` syntax and calls `onCeilingChange`.
 *   3. **Active state**: with a real ceiling, displays
 *      `used / ceiling pct%`, switches tones at 70 % / 90 %, and
 *      escalates the slash typography for pre-flight estimates.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TokenUsagePill } from '@renderer/components/composer/TokenUsagePill';

const noopCeilingChange = vi.fn();

describe('TokenUsagePill — no-ceiling state', () => {
  it('surfaces a `Set ctx` action button when ceiling is undefined', () => {
    const { getByRole, container } = render(
      <TokenUsagePill used={7} estimated onCeilingChange={noopCeilingChange} />
    );
    const btn = getByRole('button');
    expect(btn.textContent?.toLowerCase()).toContain('set ctx');
    // Used count is still visible so the user knows the counter is alive.
    expect(container.textContent).toContain('7');
  });

  it('uses the warning tone to draw the eye to the missing ceiling', () => {
    const { getByRole } = render(
      <TokenUsagePill used={7} estimated onCeilingChange={noopCeilingChange} />
    );
    expect(getByRole('button').className).toContain('text-warning');
  });

  it('routes primary click to the Inspector when wired (instead of the inline editor)', () => {
    const onOpenInspector = vi.fn();
    const onCeilingChange = vi.fn();
    const { getByRole } = render(
      <TokenUsagePill
        used={22000}
        estimated
        onCeilingChange={onCeilingChange}
        onOpenInspector={onOpenInspector}
      />
    );
    // Pill renders the `set ceiling` CTA so the user sees both the
    // missing ceiling AND the action that resolves it; primary click
    // takes them to the Inspector where the editor + summarize tools
    // live. The earlier `no ctx` literal read as "no context" and
    // confused first-time users.
    const btn = getByRole('button', { name: /Open Context Inspector/i });
    expect(btn.textContent?.toLowerCase()).toContain('set ceiling');
    fireEvent.click(btn);
    expect(onOpenInspector).toHaveBeenCalledTimes(1);
    // Editor must NOT have opened — that lives behind the dedicated
    // pencil affordance below.
    expect(onCeilingChange).not.toHaveBeenCalled();
  });

  it('keeps the pencil affordance reachable for the inline ceiling editor', () => {
    const onOpenInspector = vi.fn();
    const onCeilingChange = vi.fn();
    const { getByRole, getByPlaceholderText } = render(
      <TokenUsagePill
        used={22000}
        estimated
        onCeilingChange={onCeilingChange}
        onOpenInspector={onOpenInspector}
      />
    );
    fireEvent.click(getByRole('button', { name: /Set context window ceiling/i }));
    const input = getByPlaceholderText(/128k/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '64k' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCeilingChange).toHaveBeenCalledWith(64_000);
    // Pencil click must NOT have re-fired the Inspector primary action.
    expect(onOpenInspector).not.toHaveBeenCalled();
  });
});

describe('TokenUsagePill — inline editor', () => {
  it('opens an input with `128k`-style placeholder when clicked from the unset state', () => {
    const { getByRole, getByPlaceholderText } = render(
      <TokenUsagePill used={0} estimated={false} onCeilingChange={noopCeilingChange} />
    );
    fireEvent.click(getByRole('button'));
    expect(getByPlaceholderText(/128k/i)).toBeTruthy();
  });

  it('parses `128k` and forwards the integer value to onCeilingChange', () => {
    const onCeilingChange = vi.fn();
    const { getByRole, getByPlaceholderText } = render(
      <TokenUsagePill used={0} estimated={false} onCeilingChange={onCeilingChange} />
    );
    fireEvent.click(getByRole('button'));
    const input = getByPlaceholderText(/128k/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '128k' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCeilingChange).toHaveBeenCalledWith(128_000);
  });

  it('parses `1.5M`', () => {
    const onCeilingChange = vi.fn();
    const { getByRole, getByPlaceholderText } = render(
      <TokenUsagePill used={0} estimated={false} onCeilingChange={onCeilingChange} />
    );
    fireEvent.click(getByRole('button'));
    const input = getByPlaceholderText(/128k/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1.5M' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCeilingChange).toHaveBeenCalledWith(1_500_000);
  });

  it('clears the override when the user submits an empty input', () => {
    const onCeilingChange = vi.fn();
    const { container, getByPlaceholderText } = render(
      <TokenUsagePill
        used={1000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={onCeilingChange}
      />
    );
    fireEvent.click(container.querySelector('button')!);
    const input = getByPlaceholderText(/128k/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCeilingChange).toHaveBeenCalledWith(null);
  });

  it('Escape cancels without calling onCeilingChange', () => {
    const onCeilingChange = vi.fn();
    const { getByRole, getByPlaceholderText } = render(
      <TokenUsagePill used={0} estimated={false} onCeilingChange={onCeilingChange} />
    );
    fireEvent.click(getByRole('button'));
    const input = getByPlaceholderText(/128k/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '128k' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCeilingChange).not.toHaveBeenCalled();
  });
});

describe('TokenUsagePill — active state', () => {
  it('renders used/ceiling and an explicit pct label', () => {
    const { container } = render(
      <TokenUsagePill
        used={64_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
      />
    );
    const text = container.textContent ?? '';
    expect(text).toContain('64k');
    expect(text).toContain('128k');
    expect(text).toContain('50%');
  });

  // Phase 4 (2026) tooltip breakdown tests ─────────────────────────
  it('exposes the prompt + completion breakdown on the title attribute when usage is set', () => {
    const { container } = render(
      <TokenUsagePill
        used={20_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
        usage={{
          promptTokens: 18_200,
          completionTokens: 1_700,
          totalTokens: 19_900
        }}
      />
    );
    const title = container.querySelector('button')?.getAttribute('title') ?? '';
    expect(title).toContain('Prompt: 18.2k');
    expect(title).toContain('Completion: 1.7k');
    // No cached / reasoning / cache-write lines when those fields are
    // absent (keeps the tooltip focused).
    expect(title).not.toContain('cached');
    expect(title).not.toContain('reasoning');
    expect(title).not.toContain('cache write');
  });

  it('surfaces cached prompt tokens when the provider reported them', () => {
    const { container } = render(
      <TokenUsagePill
        used={20_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
        usage={{
          promptTokens: 18_200,
          completionTokens: 1_700,
          totalTokens: 19_900,
          cachedPromptTokens: 4_200
        }}
      />
    );
    const title = container.querySelector('button')?.getAttribute('title') ?? '';
    expect(title).toContain('· cached: 4.2k');
  });

  it('surfaces reasoning tokens when reasoning models reported them', () => {
    const { container } = render(
      <TokenUsagePill
        used={20_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
        usage={{
          promptTokens: 18_200,
          completionTokens: 2_300,
          totalTokens: 20_500,
          reasoningTokens: 580
        }}
      />
    );
    const title = container.querySelector('button')?.getAttribute('title') ?? '';
    expect(title).toContain('· reasoning: 580');
  });

  it('surfaces cache-write tokens (Anthropic-only) when reported', () => {
    const { container } = render(
      <TokenUsagePill
        used={20_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
        usage={{
          promptTokens: 18_200,
          completionTokens: 1_700,
          totalTokens: 19_900,
          cacheCreationTokens: 1_100
        }}
      />
    );
    const title = container.querySelector('button')?.getAttribute('title') ?? '';
    expect(title).toContain('· cache write: 1.1k');
  });

  it('shows the pre-flight baseline + draft split when no real usage has landed', () => {
    const { container } = render(
      <TokenUsagePill
        used={21_742}
        ceiling={128_000}
        estimated
        onCeilingChange={noopCeilingChange}
        baseline={{
          total: 21_600,
          systemPrompt: 18_500,
          history: 0,
          tools: 3_100
        }}
        draftTokens={142}
      />
    );
    const title = container.querySelector('button')?.getAttribute('title') ?? '';
    expect(title).toContain('Pre-flight: 21.6k baseline + 142 draft');
    expect(title).toContain('· system prompt: 18.5k');
    expect(title).toContain('· tools: 3.1k');
    expect(title).toContain('· history: 0');
  });

  it('hides the baseline section once authoritative usage is available', () => {
    const { container } = render(
      <TokenUsagePill
        used={20_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
        usage={{
          promptTokens: 18_200,
          completionTokens: 1_700,
          totalTokens: 19_900
        }}
        baseline={{ total: 21_600, systemPrompt: 18_500, history: 0, tools: 3_100 }}
        draftTokens={142}
      />
    );
    const title = container.querySelector('button')?.getAttribute('title') ?? '';
    expect(title).not.toContain('Pre-flight:');
    expect(title).toContain('Prompt: 18.2k');
  });

  it('shows `<1%` rather than `0%` for tiny but non-zero ratios', () => {
    const { container } = render(
      <TokenUsagePill
        used={7}
        ceiling={1_000_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
      />
    );
    expect(container.textContent).toContain('<1%');
  });

  it('italicizes the slash when value is a pre-flight estimate', () => {
    const { container } = render(
      <TokenUsagePill
        used={10_000}
        ceiling={128_000}
        estimated
        onCeilingChange={noopCeilingChange}
      />
    );
    const slashSpan = container.querySelector('span.italic');
    expect(slashSpan?.textContent).toBe('/');
  });

  it('keeps the slash upright once usage is authoritative', () => {
    const { container } = render(
      <TokenUsagePill
        used={10_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
      />
    );
    expect(container.querySelector('span.italic')).toBeFalsy();
  });

  it('uses the warning tone above 70% usage', () => {
    const { container } = render(
      <TokenUsagePill
        used={90_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
      />
    );
    expect(container.querySelector('button')?.className).toContain('text-warning');
  });

  it('uses the danger tone above 90% usage', () => {
    const { container } = render(
      <TokenUsagePill
        used={120_000}
        ceiling={128_000}
        estimated={false}
        onCeilingChange={noopCeilingChange}
      />
    );
    expect(container.querySelector('button')?.className).toContain('text-danger');
  });
});

